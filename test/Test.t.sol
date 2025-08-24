// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Test.sol";
import "src/ComplianceRegistry.sol";
import "src/SecurityToken.sol";
import "src/MintableERC20.sol";
import "src/DVPEscrow.sol";

contract PoCTest is Test {
    ComplianceRegistry compliance;
    SecurityToken sect;
    MintableERC20 wcash;
    DVPEscrow dvp;

    address user = address(0x1234);

    // Declare the events locally so we can expect/emit them
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Issued(address indexed to, uint256 amount, uint256 appId);
    event Redeemed(address indexed from, uint256 amount, bytes32 refId);

    function setUp() public {
        compliance = new ComplianceRegistry(address(this));
        sect = new SecurityToken(address(this), address(compliance));
        wcash = new MintableERC20("wCash", "WCASH", address(this));
        dvp = new DVPEscrow();

        sect.grantRole(keccak256("MINTER_ROLE"), address(this));
        sect.grantRole(keccak256("BURNER_ROLE"), address(this));
        wcash.grantRole(keccak256("MINTER_ROLE"), address(this));

        compliance.setKYC(user, true);
    }

    function testMintAndTransfer() public {
        vm.expectEmit(true, true, false, true);
        emit Issued(user, 100e18, 1);
        sect.mint(user, 100e18, 1);
        assertEq(sect.balanceOf(user), 100e18);

        vm.expectEmit(true, true, false, true);
        emit Transfer(address(0), user, 5000e18); // ✅ do NOT prefix with MintableERC20.
        wcash.mint(user, 5000e18);
        assertEq(wcash.balanceOf(user), 5000e18);
    }

    function testRedeem() public {
        sect.mint(user, 100e18, 1);
        vm.startPrank(user);
        sect.approve(address(this), 10e18);
        vm.stopPrank();

        vm.expectEmit(true, true, false, true);
        emit Redeemed(user, 10e18, keccak256("REF1"));
        sect.burnFrom(user, 10e18, keccak256("REF1"));
    }
}
