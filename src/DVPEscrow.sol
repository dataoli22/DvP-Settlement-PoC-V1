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
        require(o.seller != address(0), "DVP:no order");
        require(o.secLocked && o.cashLocked, "DVP:not funded");
        require(!o.settled, "DVP:settled");
        require(block.timestamp <= o.deadline, "DVP:expired");

        o.settled = true;

        o.sec.safeTransfer(o.buyer,  o.secAmt);
        o.cash.safeTransfer(o.seller, o.cashAmt);

        emit Settled(id);
    }

    /// Refunds after deadline if not settled
    function cancel(bytes32 id) external nonReentrant {
        Order storage o = _orders[id];
        require(o.seller != address(0), "DVP:no order");
        require(block.timestamp > o.deadline, "DVP:not expired");
        require(!o.settled, "DVP:settled");

        if (o.secLocked)  o.sec.safeTransfer(o.seller, o.secAmt);
        if (o.cashLocked) o.cash.safeTransfer(o.buyer,  o.cashAmt);

        delete _orders[id];
        emit Cancelled(id);
    }

    /// View helper
    function getOrder(bytes32 id) external view returns (Order memory) {
        return _orders[id];
    }
}
