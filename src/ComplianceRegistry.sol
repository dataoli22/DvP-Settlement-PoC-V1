// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/access/AccessControl.sol";

contract ComplianceRegistry is AccessControl {
    bytes32 public constant KYC_ADMIN_ROLE = keccak256("KYC_ADMIN_ROLE");
    mapping(address => bool) public isKYCd;

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(KYC_ADMIN_ROLE, admin);
    }

    function setKYC(address a, bool ok) external onlyRole(KYC_ADMIN_ROLE) {
        isKYCd[a] = ok;
    }

    function canTransfer(address from, address to, uint256) external view returns (bool) {
        // allow minting (from=0) and burning (to=0)
        if (from == address(0) || to == address(0)) return true;
        return isKYCd[from] && isKYCd[to];
    }
}
