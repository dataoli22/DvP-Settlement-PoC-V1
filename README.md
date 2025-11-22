# Security Token DVP Platform - PoC V1

A Proof of Concept for compliant security token trading with Delivery-versus-Payment (DVP) settlement. Built with Foundry (Solidity 0.8.23) and React.

## Overview

- **SecurityToken**: ERC20 with KYC/compliance enforcement on all transfers
- **ComplianceRegistry**: Whitelist-based KYC registry
- **DVPEscrow**: Atomic swap mechanism for securities vs cash settlement
- **MintableERC20**: Simple tokens for wCash/wCBDC payment rails
- **Frontend**: React + Vite UI for wallet interaction and DVP trading

## Architecture

### Smart Contracts (`src/`)

- **SecurityToken.sol**: ERC20 + AccessControl with compliance hooks
- **ComplianceRegistry.sol**: KYC whitelist with `canTransfer()` validation
- **DVPEscrow.sol**: Order-based escrow with atomic settlement
- **MintableERC20.sol**: Basic ERC20 for cash tokens

### Scripts (`script/`)

- **Deploy.s.sol**: Deploys all contracts and sets up roles
- **DVPCreateAndSettle.s.sol**: DVP workflow examples

### Frontend (`foundry-tools/frontend/`)

React 19 + Vite 7 + Tailwind CSS with native Web3 (no ethers.js)

## Quick Start

```shell
# Install dependencies
forge install
cd foundry-tools/frontend && npm install && cd ../..

# Configure .env
echo "DEPLOYER_PK=<your_key>" >> .env
echo "OP_SEPOLIA_RPC=https://sepolia.optimism.io" >> .env

# Build
forge build

# Test
forge test -vvv

# Deploy locally
anvil
forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast

# Run frontend
cd foundry-tools/frontend && npm run dev
```

## Contract Details

### SecurityToken.sol

ERC20 with compliance enforcement via `_update()` override:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ERC20}         from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "openzeppelin-contracts/contracts/access/AccessControl.sol";

interface ICompliance { function canTransfer(address,address,uint256) external view returns (bool); }

contract SecToken is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

    ICompliance public compliance;

    event Issued(address indexed to, uint256 amount, uint256 appId);
    event Redeemed(address indexed from, uint256 amount, bytes32 refId);

    constructor(address admin, address compliance_) ERC20("SecToken","SECT") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        compliance = ICompliance(compliance_);
    }

    function mint(address to, uint256 amount, uint256 appId) external onlyRole(MINTER_ROLE) {
        _mint(to, amount); emit Issued(to, amount, appId);
    }

    function burnFrom(address from, uint256 amount, bytes32 refId) external onlyRole(BURNER_ROLE) {
        _spendAllowance(from, msg.sender, amount); _burn(from, amount); emit Redeemed(from, amount, refId);
    }

    function _update(address from, address to, uint256 value) internal override {
        require(compliance.canTransfer(from, to, value), "KYC/transfer restricted");
        super._update(from, to, value);
    }
}
```

**Roles**: `MINTER_ROLE`, `BURNER_ROLE`  
**Events**: `Issued(address to, uint256 amount, uint256 appId)`, `Redeemed(address from, uint256 amount, bytes32 refId)`

### ComplianceRegistry.sol

KYC whitelist registry:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

contract ComplianceRegistry is AccessControl {
    bytes32 public constant KYC_ADMIN_ROLE = keccak256("KYC_ADMIN_ROLE");

    mapping(address => bool) public isKYCd;

    event KYCSet(address indexed subject, bool ok, address indexed admin);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(KYC_ADMIN_ROLE, admin);
    }

    function setKYC(address a, bool ok) external onlyRole(KYC_ADMIN_ROLE) {
        isKYCd[a] = ok;
        emit KYCSet(a, ok, msg.sender);
    }

    /// @notice mint (from=0) and burn (to=0) are always allowed
    function canTransfer(address from, address to, uint256) external view returns (bool) {
        if (from == address(0) || to == address(0)) return true;
        return isKYCd[from] && isKYCd[to];
    }
}
```

**Role**: `KYC_ADMIN_ROLE`  
**Note**: Mint/burn operations (from/to zero address) always allowed

### DVPEscrow.sol

Order-based escrow with atomic settlement:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}       from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract DVPEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Order {
        address seller;
        address buyer;
        IERC20  sec;
        uint256 secAmt;
        IERC20  cash;
        uint256 cashAmt;
        uint64  deadline;   // unix seconds
        bool    secLocked;
        bool    cashLocked;
        bool    settled;
    }

    mapping(bytes32 => Order) private _orders;

    event EscrowInitiated(bytes32 indexed id, address indexed seller, address indexed buyer);
    event SecurityLocked(bytes32 indexed id);
    event CashLocked(bytes32 indexed id);
    event Settled(bytes32 indexed id);
    event Cancelled(bytes32 indexed id);

    /// Create an order
    function initiate(
        bytes32 id,
        address seller,
        address buyer,
        IERC20 sec,
        uint256 secAmt,
        IERC20 cash,
        uint256 cashAmt,
        uint64 deadline
    ) external {
        require(_orders[id].seller == address(0), "DVP:order exists");
        require(seller != address(0) && buyer != address(0), "DVP:bad parties");
        require(address(sec) != address(0) && address(cash) != address(0), "DVP:zero token");
        require(secAmt > 0 && cashAmt > 0, "DVP:zero amount");
        require(deadline > block.timestamp, "DVP:deadline past");

        _orders[id] = Order({
            seller: seller,
            buyer: buyer,
            sec: sec,
            secAmt: secAmt,
            cash: cash,
            cashAmt: cashAmt,
            deadline: deadline,
            secLocked: false,
            cashLocked: false,
            settled: false
        });

        emit EscrowInitiated(id, seller, buyer);
    }

    /// Seller deposits security leg
    function depositSecurity(bytes32 id) external nonReentrant {
        Order storage o = _orders[id];
        require(o.seller != address(0), "DVP:no order");
        require(msg.sender == o.seller, "DVP:not seller");
        require(!o.secLocked, "DVP:sec locked");

        o.sec.safeTransferFrom(o.seller, address(this), o.secAmt);
        o.secLocked = true;
        emit SecurityLocked(id);
    }

    /// Buyer deposits cash leg
    function depositCash(bytes32 id) external nonReentrant {
        Order storage o = _orders[id];
        require(o.buyer != address(0), "DVP:no order");
        require(msg.sender == o.buyer, "DVP:not buyer");
        require(!o.cashLocked, "DVP:cash locked");

        o.cash.safeTransferFrom(o.buyer, address(this), o.cashAmt);
        o.cashLocked = true;
        emit CashLocked(id);
    }

    /// Atomic swap when both legs funded
    function settle(bytes32 id) external nonReentrant {
        Order storage o = _orders[id];
        require(o.secLocked && o.cashLocked, "DVP:not funded");
        require(!o.settled && block.timestamp <= o.deadline, "DVP:settled/expired");

        o.settled = true;
        o.sec.safeTransfer(o.buyer, o.secAmt);
        o.cash.safeTransfer(o.seller, o.cashAmt);
        emit Settled(id);
    }
}
```

**Flow**: `initiate()` → `depositSecurity()` → `depositCash()` → `settle()` / `cancel()`  
**Protection**: ReentrancyGuard, SafeERC20

### MintableERC20.sol

Basic ERC20 for payment tokens:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ERC20}        from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "openzeppelin-contracts/contracts/access/AccessControl.sol";

contract MintableERC20 is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    constructor(string memory n, string memory s, address admin) ERC20(n, s) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function mint(address to, uint256 amt) external onlyRole(MINTER_ROLE) {
        _mint(to, amt);
    }

    /// simple controlled burn (PoC): same MINTER_ROLE can burn
    function burn(address from, uint256 amt) external onlyRole(MINTER_ROLE) {
        _burn(from, amt);
    }
}
```

**Role**: `MINTER_ROLE` (for both mint and burn)

## DVP Order Flow

```
initiate() → depositSecurity() → depositCash() → settle()
                                               ↘ cancel() (after deadline)
```

1. **Initiate**: Create order (id, seller, buyer, tokens, amounts, deadline)
2. **Deposit Security**: Seller locks securities
3. **Deposit Cash**: Buyer locks cash
4. **Settle**: Atomic swap when both locked (anyone can trigger)
5. **Cancel**: Refund if deadline passed without settlement

## Security Notes

⚠️ **PoC only - not production ready**

- No formal audit
- Uses `.env` for private keys
- DVP lacks partial fills, amendments
- Limited test coverage

✅ **Implemented**: ReentrancyGuard, AccessControl, SafeERC20, compliance hooks

## Tech Stack

- Solidity 0.8.23 (Paris EVM)
- Foundry + OpenZeppelin 5.4.0
- React 19 + Vite 7 + Tailwind CSS

## License

MIT
