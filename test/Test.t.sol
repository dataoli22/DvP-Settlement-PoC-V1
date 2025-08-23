// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Test.sol";
import "../src/ComplianceRegistry.sol";
import "../src/SecurityToken.sol";
import "../src/MintableERC20.sol";
import "../src/DVPEscrow.sol";

contract PoCTest is Test {
    ComplianceRegistry compliance;
    SecurityToken sect;
    MintableERC20 wcash;
    DVPEscrow dvp;

    address user = address(0xABCD);

    function setUp() public {
        // Deploy contracts
        compliance = new ComplianceRegistry(address(this));
        sect = new SecurityToken(address(this), address(compliance));
        wcash = new MintableERC20("wCash", "WCASH", address(this));
        dvp = new DVPEscrow();

        // Grant roles to test contract (this)
        bytes32 MINTER = keccak256("MINTER_ROLE");
        bytes32 BURNER = keccak256("BURNER_ROLE");
        bytes32 KYC_ADMIN = keccak256("KYC_ADMIN_ROLE");

        compliance.grantRole(KYC_ADMIN, address(this));
        sect.grantRole(MINTER, address(this));
        sect.grantRole(BURNER, address(this));
        wcash.grantRole(MINTER, address(this));
    }

    function testFullLifecycleWithEvents() public {
        // 1. KYC user
        compliance.setKYC(user, true);

        // 2. Mint tokens to user
        vm.expectEmit(true, true, false, true);
        emit SecurityToken.Issued(user, 100e18, 1);
        sect.mint(user, 100e18, 1);

        vm.expectEmit(true, true, false, true);
        emit MintableERC20.Transfer(address(0), user, 5000e18);
        wcash.mint(user, 5000e18);

        assertEq(sect.balanceOf(user), 100e18);
        assertEq(wcash.balanceOf(user), 5000e18);

        // 3. User approves escrow
        vm.startPrank(user);
        sect.approve(address(dvp), 50e18);
        wcash.approve(address(dvp), 5000e18);

        // 4. Create & settle escrow
        bytes32 orderId = keccak256("ORDER1");

        vm.expectEmit(true, true, false, true);
        emit DVPEscrow.EscrowInitiated(orderId, user, user);
        dvp.initiate(orderId, user, user, sect, 50e18, wcash, 5000e18, uint64(block.timestamp + 1 hours));

        vm.expectEmit(true, false, false, true);
        emit DVPEscrow.SecurityLocked(orderId);
        dvp.depositSecurity(orderId);

        vm.expectEmit(true, false, false, true);
        emit DVPEscrow.CashLocked(orderId);
        dvp.depositCash(orderId);

        vm.expectEmit(true, false, false, true);
        emit DVPEscrow.Settled(orderId);
        dvp.settle(orderId);

        // 5. Redeem 10 SECT
        sect.approve(user, 10e18); // self-approval just to demo burnFrom

        vm.expectEmit(true, true, false, true);
        emit SecurityToken.Redeemed(user, 10e18, keccak256("REDEEM1"));
        sect.burnFrom(user, 10e18, keccak256("REDEEM1"));

        vm.stopPrank();

        // Final checks
        assertEq(sect.balanceOf(user), 40e18);    // 100 - 50 - 10
        assertEq(wcash.balanceOf(user), 10000e18); // 5000 + 5000 from escrow
    }
}
