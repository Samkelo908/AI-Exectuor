// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

contract ArcBotDecisionLogger {
    
    struct Decision {
        address agent;
        string decisionId;
        string actionSummary;
        string rationaleCID;
        uint256 timestamp;
        string txRef;
        DecisionStatus status;
        uint256 totalAmount;
        uint8 riskScore;
    }
    
    enum DecisionStatus { LOGGED, EXECUTED, FAILED, CANCELLED }
    
    address public owner;
    bool public paused;
    
    mapping(string => Decision) public decisions;
    mapping(address => string[]) public agentDecisions;
    string[] public allDecisionIds;
    mapping(address => bool) public authorizedAgents;
    mapping(address => uint256) public agentDecisionCount;
    uint256 public totalDecisions;
    
    event DecisionLogged(address indexed agent, string indexed decisionId, string actionSummary, uint256 totalAmount, uint8 riskScore, uint256 timestamp);
    event DecisionStatusUpdated(string indexed decisionId, DecisionStatus oldStatus, DecisionStatus newStatus, string txRef);
    event AgentAuthorized(address indexed agent, bool authorized);
    
    error DecisionAlreadyExists(string decisionId);
    error DecisionNotFound(string decisionId);
    error InvalidDecisionId();
    error UnauthorizedAgent(address agent);
    error InvalidRiskScore();
    error ContractPaused();
    error NotOwner();
    
    constructor() {
        owner = msg.sender;
        authorizedAgents[msg.sender] = true;
        emit AgentAuthorized(msg.sender, true);
    }
    
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }
    
    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }
    
    modifier onlyAuthorizedAgent() {
        if (!authorizedAgents[msg.sender]) revert UnauthorizedAgent(msg.sender);
        _;
    }
    
    modifier validDecisionId(string memory decisionId) {
        if (bytes(decisionId).length == 0) revert InvalidDecisionId();
        _;
    }
    
    function logDecision(
        string memory decisionId, 
        string memory actionSummary, 
        string memory rationaleCID, 
        string memory txRef, 
        uint256 totalAmount, 
        uint8 riskScore
    ) external whenNotPaused onlyAuthorizedAgent validDecisionId(decisionId) returns (bool) {
        if (bytes(decisions[decisionId].decisionId).length != 0) revert DecisionAlreadyExists(decisionId);
        if (riskScore > 100) revert InvalidRiskScore();
        
        decisions[decisionId] = Decision({
            agent: msg.sender,
            decisionId: decisionId,
            actionSummary: actionSummary,
            rationaleCID: rationaleCID,
            timestamp: block.timestamp,
            txRef: txRef,
            status: DecisionStatus.LOGGED,
            totalAmount: totalAmount,
            riskScore: riskScore
        });
        
        agentDecisions[msg.sender].push(decisionId);
        allDecisionIds.push(decisionId);
        agentDecisionCount[msg.sender]++;
        totalDecisions++;
        
        emit DecisionLogged(msg.sender, decisionId, actionSummary, totalAmount, riskScore, block.timestamp);
        return true;
    }
    
    function updateDecisionStatus(
        string memory decisionId, 
        DecisionStatus newStatus, 
        string memory txRef
    ) external whenNotPaused onlyAuthorizedAgent validDecisionId(decisionId) returns (bool) {
        Decision storage decision = decisions[decisionId];
        if (bytes(decision.decisionId).length == 0) revert DecisionNotFound(decisionId);
        require(decision.agent == msg.sender, "Not decision owner");
        
        DecisionStatus oldStatus = decision.status;
        decision.status = newStatus;
        if (bytes(txRef).length > 0) {
            decision.txRef = txRef;
        }
        
        emit DecisionStatusUpdated(decisionId, oldStatus, newStatus, txRef);
        return true;
    }
    
    function getDecision(string memory decisionId) external view validDecisionId(decisionId) returns (Decision memory) {
        Decision memory decision = decisions[decisionId];
        if (bytes(decision.decisionId).length == 0) revert DecisionNotFound(decisionId);
        return decision;
    }
    
    function getAgentDecisions(address agent) external view returns (string[] memory) {
        return agentDecisions[agent];
    }
    
    function getTotalDecisions() external view returns (uint256) {
        return totalDecisions;
    }
    
    function getAgentStats(address agent) external view returns (
        uint256 totalDecisionsCount, 
        uint256 totalVolume, 
        bool isAuthorized
    ) {
        totalDecisionsCount = agentDecisionCount[agent];
        isAuthorized = authorizedAgents[agent];
        
        string[] memory agentDecisionList = agentDecisions[agent];
        for (uint256 i = 0; i < agentDecisionList.length; i++) {
            totalVolume += decisions[agentDecisionList[i]].totalAmount;
        }
    }
    
    function setAgentAuthorization(address agent, bool authorized) external onlyOwner {
        require(agent != address(0), "Invalid agent address");
        authorizedAgents[agent] = authorized;
        emit AgentAuthorized(agent, authorized);
    }
    
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
    }
    
    receive() external payable {}
}