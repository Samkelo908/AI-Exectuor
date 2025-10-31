// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Script.sol";
import "../src/ArcBotDecisionLogger.sol";

contract DeployScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);
        
        ArcBotDecisionLogger logger = new ArcBotDecisionLogger();
        
        console.log("===========================================");
        console.log("ArcBot Decision Logger Deployed!");
        console.log("===========================================");
        console.log("Contract Address:", address(logger));
        console.log("Deployer:", msg.sender);
        console.log("===========================================");
        
        vm.stopBroadcast();
    }
}
