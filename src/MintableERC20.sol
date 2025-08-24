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

