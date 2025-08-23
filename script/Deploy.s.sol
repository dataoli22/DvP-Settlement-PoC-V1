// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Script.sol";
import "../src/MintableERC20.sol";
import "../src/DVPEscrow.sol";
import "../src/ComplianceRegistry.sol";
import "../src/SecurityToken.sol";

contract Deploy is Script {
    function run() external {
        // Load deployer from env
        uint256 deployerKey = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        // 1. Deploy Compliance Registry
        ComplianceRegistry compliance = new ComplianceRegistry(deployer);

        // 2. Deploy Security Token (linked to compliance)
        SecurityToken sect = new SecurityToken(deployer, address(compliance));

        // 3. Deploy wCash and wCBDC
        MintableERC20 wcash = new MintableERC20("wCash", "WCASH", deployer);
        MintableERC20 wcbdc = new MintableERC20("wCBDC", "WCBDC", deployer);

        // 4. Deploy DVPEscrow
        DVPEscrow dvp = new DVPEscrow();

        // 5. Compute role hashes
        bytes32 MINTER_ROLE   = keccak256("MINTER_ROLE");
        bytes32 BURNER_ROLE   = keccak256("BURNER_ROLE");
        bytes32 KYC_ADMIN_ROLE = keccak256("KYC_ADMIN_ROLE");

        // 6. Grant all roles to deployer
        compliance.grantRole(KYC_ADMIN_ROLE, deployer);
        sect.grantRole(MINTER_ROLE, deployer);
        sect.grantRole(BURNER_ROLE, deployer);
        wcash.grantRole(MINTER_ROLE, deployer);
        wcbdc.grantRole(MINTER_ROLE, deployer);

        vm.stopBroadcast();

        // Log addresses
        console2.log("ComplianceRegistry:", address(compliance));
        console2.log("SecurityToken:", address(sect));
        console2.log("wCash:", address(wcash));
        console2.log("wCBDC:", address(wcbdc));
        console2.log("DVPEscrow:", address(dvp));
        console2.log("Deployer (all roles):", deployer);
    }
}
