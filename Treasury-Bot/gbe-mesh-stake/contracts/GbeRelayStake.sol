// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

interface IERC20Decimals {
    function decimals() external view returns (uint8);
}

/// @title GbeRelayStake
/// @notice Stake GC tokens to operate a relay and earn rewards per GB forwarded.
contract GbeRelayStake is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // === Tokens & Roles ===
    IERC20 public immutable gc;         // GC ERC20 token (must be 18 decimals)
    address public oracle;              // Address authorized to report traffic & heartbeat

    // === Staking & Reward Params ===
    uint256 public constant STAKE          = 250e18;   // 250 GC
    uint256 public constant REWARD_PER_GB  = 0.5e18;   // 0.5 GC per GB forwarded
    uint256 public constant BYTES_PER_GB   = 1e9;      // bytes in one GB
    uint256 public constant MIN_LOCK       = 30 days;  // minimum staking duration
    uint256 public constant MAX_INACTIVITY = 12 hours; // max allowed heartbeat gap

    struct Relay {
        uint64  startTime;
        uint64  lastPing;
        uint128 bytesForwarded;
    }
    mapping(address => Relay) private _relays;

    // === Events ===
    event RelayRegistered(address indexed relayer, bytes32 indexed nodeId);
    event TrafficReported(address indexed relayer, uint256 bytesFwd);
    event Heartbeat(address indexed relayer, uint64 timestamp);
    event RewardClaimed(address indexed relayer, uint256 amount);
    event StakeReleased(address indexed relayer);
    event OracleUpdated(address indexed oldOracle, address indexed newOracle);
    event RescueTokens(address indexed token, address indexed to, uint256 amount);

    /// @param _gc      GC token address (must implement IERC20 and have 18 decimals)
    /// @param _oracle  Initial oracle address
    constructor(IERC20 _gc, address _oracle) {
        require(address(_gc) != address(0), "Invalid GC token");
        require(_oracle != address(0), "Invalid oracle");

        // Enforce 18-decimal token
        uint8 dec = IERC20Decimals(address(_gc)).decimals();
        require(dec == 18, "Token must have 18 decimals");

        gc     = _gc;
        oracle = _oracle;
    }

    modifier onlyOracle() {
        require(msg.sender == oracle, "Caller is not oracle");
        _;
    }

    /// @notice Pause user and oracle operations
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume operations
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Update the oracle address
    function updateOracle(address newOracle) external onlyOwner {
        require(newOracle != address(0), "Invalid oracle");
        emit OracleUpdated(oracle, newOracle);
        oracle = newOracle;
    }

    /// @notice Stake GC and register a relay node
    /// @param nodeId Unique identifier for the relay node
    function registerRelay(bytes32 nodeId)
        external
        whenNotPaused
        nonReentrant
    {
        require(_relays[msg.sender].startTime == 0, "Already registered");
        gc.safeTransferFrom(msg.sender, address(this), STAKE);

        _relays[msg.sender] = Relay({
            startTime:      uint64(block.timestamp),
            lastPing:       uint64(block.timestamp),
            bytesForwarded: 0
        });

        emit RelayRegistered(msg.sender, nodeId);
    }

    /// @notice Report forwarded bytes since last report
    /// @param relayer Address of the relay
    /// @param bytesFwd Bytes forwarded since last report
    function reportTraffic(address relayer, uint256 bytesFwd)
        external
        onlyOracle
        whenNotPaused
    {
        Relay storage r = _relays[relayer];
        require(r.startTime != 0, "Relay not registered");
        r.bytesForwarded += uint128(bytesFwd);
        emit TrafficReported(relayer, bytesFwd);
    }

    /// @notice Send a heartbeat for an active relay
    /// @param relayer Address of the relay
    function heartbeat(address relayer)
        external
        onlyOracle
        whenNotPaused
    {
        Relay storage r = _relays[relayer];
        require(r.startTime != 0, "Relay not registered");
        r.lastPing = uint64(block.timestamp);
        emit Heartbeat(relayer, r.lastPing);
    }

    /// @notice Claim accumulated rewards based on forwarded traffic
    function claimReward()
        external
        whenNotPaused
        nonReentrant
    {
        Relay storage r = _relays[msg.sender];
        uint256 payout = (uint256(r.bytesForwarded) * REWARD_PER_GB) / BYTES_PER_GB;
        require(payout > 0, "No rewards to claim");

        r.bytesForwarded = 0;
        gc.safeTransfer(msg.sender, payout);
        emit RewardClaimed(msg.sender, payout);
    }

    /// @notice Withdraw staked GC after lock period and active heartbeat
    function withdrawStake()
        external
        whenNotPaused
        nonReentrant
    {
        Relay storage r = _relays[msg.sender];
        require(r.startTime != 0, "Relay not registered");
        require(block.timestamp >= r.startTime + MIN_LOCK, "Lock period not ended");
        require(block.timestamp - r.lastPing <= MAX_INACTIVITY, "Relay considered offline");

        delete _relays[msg.sender];
        gc.safeTransfer(msg.sender, STAKE);
        emit StakeReleased(msg.sender);
    }

    /// @notice Get pending rewards for a relayer
    /// @param relayer Address of the relay
    function pendingReward(address relayer) external view returns (uint256) {
        Relay storage r = _relays[relayer];
        return (uint256(r.bytesForwarded) * REWARD_PER_GB) / BYTES_PER_GB;
    }

    /// @notice Rescue any ERC20 tokens accidentally sent to this contract
    /// @param token Address of the token to rescue
    /// @param to Recipient address
    function rescueERC20(IERC20 token, address to) external onlyOwner {
        require(to != address(0), "Invalid recipient");
        uint256 balance = token.balanceOf(address(this));
        require(balance > 0, "No tokens to rescue");
        token.safeTransfer(to, balance);
        emit RescueTokens(address(token), to, balance);
    }
}
