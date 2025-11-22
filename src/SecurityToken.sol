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
