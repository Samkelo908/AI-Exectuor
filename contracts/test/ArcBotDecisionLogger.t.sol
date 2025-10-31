// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import "../src/ArcBotDecisionLogger.sol";

contract ArcBotDecisionLoggerTest is Test {
    ArcBotDecisionLogger public logger;
    address public agent1 = address(0x1);
    
    function setUp() public {
        logger = new ArcBotDecisionLogger();
        logger.setAgentAuthorization(agent1, true);
    }
    
    function testLogDecision() public {
        vm.prank(agent1);
        bool success = logger.logDecision("inst_123", "Sent 10 USDC to Netflix", "", "tx_ref", 10000000, 30);
        assertTrue(success);
        assertEq(logger.getTotalDecisions(), 1);
    }
    
    function testGetDecision() public {
        vm.prank(agent1);
        logger.logDecision("inst_123", "Test action", "", "", 5000000, 20);
        
        ArcBotDecisionLogger.Decision memory decision = logger.getDecision("inst_123");
        assertEq(decision.agent, agent1);
        assertEq(decision.totalAmount, 5000000);
        assertEq(decision.riskScore, 20);
    }
}
