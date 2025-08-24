// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import "src/ComplianceRegistry.sol";
import "src/SecurityToken.sol";
import "src/MintableERC20.sol";
import "src/DVPEscrow.sol";

contract Deploy is Script {
    function run() external {
        // Read 0x... private key from .env
        uint256 deployerKey = uint256(vm.envBytes32("DEPLOYER_PK"));
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        // Deploy contracts
        ComplianceRegistry compliance = new ComplianceRegistry(deployer);
        // ⬇️ SecurityToken takes (admin, compliance) — **2 args**
        SecurityToken sect = new SecurityToken(deployer, address(compliance));
        MintableERC20 wcash = new MintableERC20("wCash", "WCASH", deployer);
        MintableERC20 wcbdc = new MintableERC20("wCBDC", "WCBDC", deployer);
        DVPEscrow dvp = new DVPEscrow();

        // Grant roles
        bytes32 MINTER_ROLE    = keccak256("MINTER_ROLE");
        bytes32 BURNER_ROLE    = keccak256("BURNER_ROLE");
        bytes32 KYC_ADMIN_ROLE = keccak256("KYC_ADMIN_ROLE");

        compliance.grantRole(KYC_ADMIN_ROLE, deployer);
        sect.grantRole(MINTER_ROLE, deployer);
        sect.grantRole(BURNER_ROLE, deployer);
        wcash.grantRole(MINTER_ROLE, deployer);
        wcbdc.grantRole(MINTER_ROLE, deployer);

        vm.stopBroadcast();

        // Logs
        console2.log("ComplianceRegistry:", address(compliance));
        console2.log("SecurityToken:", address(sect));
        console2.log("wCash:", address(wcash));
        console2.log("wCBDC:", address(wcbdc));
        console2.log("DVPEscrow:", address(dvp));
        console2.log("Deployer:", deployer);
    }
}
