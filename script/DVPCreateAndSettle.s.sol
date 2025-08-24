// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Script.sol";
import "src/ComplianceRegistry.sol";
import "src/SecurityToken.sol";
import "src/MintableERC20.sol";
import "src/DVPEscrow.sol";

contract DVPCreateAndSettle_Min is Script {
    function run() external {
        // 1) Read essentials (no envOr overloads)
        uint256 pk        = uint256(vm.envBytes32("DEPLOYER_PK"));
        address dvpAddr   = vm.envAddress("DVP_ADDRESS");
        address sectAddr  = vm.envAddress("SECT_ADDRESS");
        address wcashAddr = vm.envAddress("WCASH_ADDRESS");

        // 2) Cast deployed contracts
        DVPEscrow dvp        = DVPEscrow(dvpAddr);
        SecurityToken sect   = SecurityToken(sectAddr);
        MintableERC20 wcash  = MintableERC20(wcashAddr);

        // 3) Fixed demo amounts to avoid parsing issues
        uint256 secAmt  = 50e18;
        uint256 cashAmt = 5000e18;

        // 4) Fixed order id for determinism
        bytes32 orderId = keccak256("ORDER1");

        vm.startBroadcast(pk);

        // 5) Approvals
        sect.approve(dvpAddr, secAmt);
        wcash.approve(dvpAddr, cashAmt);

        // 6) Create, fund, settle (seller=buyer=self)
        address me = vm.addr(pk);
        dvp.initiate(orderId, me, me, sect, secAmt, wcash, cashAmt, uint64(block.timestamp + 1 hours));
        dvp.depositSecurity(orderId);
        dvp.depositCash(orderId);
        dvp.settle(orderId);

        vm.stopBroadcast();
    }
}
