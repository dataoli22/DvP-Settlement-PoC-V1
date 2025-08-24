// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Script.sol";
import "src/ComplianceRegistry.sol";
import "src/SecurityToken.sol";
import "src/MintableERC20.sol";
import "src/DVPEscrow.sol";

contract Interaction is Script {
    function run() external {
        uint256 deployerKey = uint256(vm.envBytes32("DEPLOYER_PK"));
        address user = vm.addr(deployerKey);

        // Addresses from .env (already deployed via Deploy.s.sol)
        address complianceAddr = vm.envAddress("COMPLIANCE_ADDRESS");
        address sectAddr       = vm.envAddress("SECT_ADDRESS");
        address wcashAddr      = vm.envAddress("WCASH_ADDRESS");
        address dvpAddr        = vm.envAddress("DVP_ADDRESS");

        // ⬇️ cast, do NOT use `new`
        ComplianceRegistry compliance = ComplianceRegistry(complianceAddr);
        SecurityToken sect = SecurityToken(sectAddr);
        MintableERC20 wcash = MintableERC20(wcashAddr);
        DVPEscrow dvp = DVPEscrow(dvpAddr);

        vm.startBroadcast(deployerKey);

        // 1. KYC user
        compliance.setKYC(user, true);

        // 2. Mint balances
        sect.mint(user, 100e18, 1);
        wcash.mint(user, 5000e18);

        // 3. Approvals
        sect.approve(dvpAddr, 50e18);
        wcash.approve(dvpAddr, 5000e18);

        // 4. DVP order create + settle
        bytes32 orderId = keccak256("ORDER1");
        dvp.initiate(orderId, user, user, sect, 50e18, wcash, 5000e18, uint64(block.timestamp + 1 hours));
        dvp.depositSecurity(orderId);
        dvp.depositCash(orderId);
        dvp.settle(orderId);

        // 5. Redeem
        sect.approve(user, 10e18);
        sect.burnFrom(user, 10e18, keccak256("REDEEM1"));

        vm.stopBroadcast();
    }
}
