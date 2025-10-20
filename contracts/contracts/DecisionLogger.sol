// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title DecisionLogger
 * @dev Logs AI agent decisions on-chain for transparency and auditability
 */
contract DecisionLogger {
    
    // Events
    event DecisionLogged(
        address indexed agent,
        string decisionId,
        string actionSummary,
        string rationaleCID,
        uint256 timestamp,
        string txRef
    );
    
    event AgentRegistered(
        address indexed agent,
        string agentName,
        uint256 timestamp
    );
    
    // Structs
    struct DecisionRecord {
        string decisionId;
        address agent;
        string actionSummary;
        string rationaleCID;
        uint256 timestamp;
        string txRef;
        bool exists;
    }
    
    struct Agent {
        string name;
        uint256 registeredAt;
        uint256 decisionCount;
        bool active;
    }
    
    // State variables
    mapping(string => DecisionRecord) public decisions;
    mapping(address => Agent) public agents;
    mapping(address => string[]) public agentDecisions;
    
    uint256 public totalDecisions;
    address public owner;
    
    // Modifiers
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this");
        _;
    }
    
    constructor() {
        owner = msg.sender;
    }
    
    /**
     * @dev Register a new agent
     * @param agentName Name of the agent
     */
    function registerAgent(string memory agentName) external {
        require(!agents[msg.sender].active, "Agent already registered");
        require(bytes(agentName).length > 0, "Agent name required");
        
        agents[msg.sender] = Agent({
            name: agentName,
            registeredAt: block.timestamp,
            decisionCount: 0,
            active: true
        });
        
        emit AgentRegistered(msg.sender, agentName, block.timestamp);
    }
    
    /**
     * @dev Log a decision on-chain
     * @param decisionId Unique identifier for the decision
     * @param actionSummary Brief summary of actions taken
     * @param rationaleCID IPFS CID of detailed rationale (optional)
     * @param txRef Reference to payment transaction (optional)
     */
    function logDecision(
        string calldata decisionId,
        string calldata actionSummary,
        string calldata rationaleCID,
        string calldata txRef
    ) external {
        require(bytes(decisionId).length > 0, "Decision ID required");
        require(bytes(actionSummary).length > 0, "Action summary required");
        require(!decisions[decisionId].exists, "Decision already logged");
        
        // Auto-register agent if not registered
        if (!agents[msg.sender].active) {
            agents[msg.sender] = Agent({
                name: "Auto-registered Agent",
                registeredAt: block.timestamp,
                decisionCount: 0,
                active: true
            });
        }
        
        // Store decision record
        decisions[decisionId] = DecisionRecord({
            decisionId: decisionId,
            agent: msg.sender,
            actionSummary: actionSummary,
            rationaleCID: rationaleCID,
            timestamp: block.timestamp,
            txRef: txRef,
            exists: true
        });
        
        // Update agent stats
        agents[msg.sender].decisionCount++;
        agentDecisions[msg.sender].push(decisionId);
        totalDecisions++;
        
        emit DecisionLogged(
            msg.sender,
            decisionId,
            actionSummary,
            rationaleCID,
            block.timestamp,
            txRef
        );
    }
    
    /**
     * @dev Get decision details
     * @param decisionId Decision identifier
     * @return Decision record
     */
    function getDecision(string memory decisionId) 
        external 
        view 
        returns (DecisionRecord memory) 
    {
        require(decisions[decisionId].exists, "Decision not found");
        return decisions[decisionId];
    }
    
    /**
     * @dev Get agent statistics
     * @param agent Agent address
     * @return Agent details
     */
    function getAgentStats(address agent) 
        external 
        view 
        returns (Agent memory) 
    {
        return agents[agent];
    }
    
    /**
     * @dev Get all decision IDs for an agent
     * @param agent Agent address
     * @return Array of decision IDs
     */
    function getAgentDecisions(address agent) 
        external 
        view 
        returns (string[] memory) 
    {
        return agentDecisions[agent];
    }
    
    /**
     * @dev Deactivate an agent (owner only)
     * @param agent Agent address
     */
    function deactivateAgent(address agent) external onlyOwner {
        require(agents[agent].active, "Agent not active");
        agents[agent].active = false;
    }
    
    /**
     * @dev Get contract statistics
     * @return Total decisions logged
     */
    function getStats() external view returns (uint256) {
        return totalDecisions;
    }
}