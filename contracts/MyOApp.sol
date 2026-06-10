// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

// LayerZero V2 OApp interfaces (inline to avoid npm dependency in Remix/copy-paste)
// Source: https://github.com/LayerZero-Labs/LayerZero-v2

interface ILayerZeroEndpointV2 {
    function send(
        MessagingParams calldata _params,
        address _refundAddress
    ) external payable returns (MessagingReceipt memory);

    function quote(
        MessagingParams calldata _params,
        address _sender
    ) external view returns (MessagingFee memory);

    function setDelegate(address _delegate) external;
}

struct MessagingParams {
    uint32 dstEid;       // destination endpoint ID
    bytes32 receiver;    // receiver address as bytes32
    bytes message;       // encoded message payload
    bytes options;       // LayerZero options (e.g. gas limit on dst)
    bool payInLzToken;   // false = pay in native token
}

struct MessagingReceipt {
    bytes32 guid;
    uint64 nonce;
    MessagingFee fee;
}

struct MessagingFee {
    uint256 nativeFee;
    uint256 lzTokenFee;
}

struct Origin {
    uint32 srcEid;
    bytes32 sender;
    uint64 nonce;
}

/**
 * @title MyOApp
 * @notice A minimal LayerZero V2 OApp that can send and receive cross-chain messages.
 *         Deploy on both Rootstock Testnet and Arbitrum Sepolia, then peer them together.
 */
contract MyOApp {
    // ─── State ────────────────────────────────────────────────────────────────

    ILayerZeroEndpointV2 public immutable endpoint;
    address public owner;

    /// @notice peer[dstEid] = trusted remote OApp address (as bytes32)
    mapping(uint32 => bytes32) public peers;

    /// @notice Last message received from a remote chain
    string public lastReceivedMessage;
    uint32 public lastSrcEid;

    // ─── Events ───────────────────────────────────────────────────────────────

    event MessageSent(uint32 indexed dstEid, string message, uint256 fee);
    event MessageReceived(uint32 indexed srcEid, bytes32 sender, string message);
    event PeerSet(uint32 indexed eid, bytes32 peer);

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "OApp: not owner");
        _;
    }

    modifier onlyEndpoint() {
        require(msg.sender == address(endpoint), "OApp: not endpoint");
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    /**
     * @param _endpoint LayerZero V2 endpoint address for this chain
     */
    constructor(address _endpoint) {
        endpoint = ILayerZeroEndpointV2(_endpoint);
        owner = msg.sender;
        // register this contract as its own delegate so it can configure options
        endpoint.setDelegate(address(this));
    }

    // ─── Configuration ────────────────────────────────────────────────────────

    /**
     * @notice Set the trusted peer on a remote chain.
     *         Must be called after both contracts are deployed.
     * @param _eid   Remote endpoint ID
     * @param _peer  Remote OApp address, left-padded to bytes32
     */
    function setPeer(uint32 _eid, bytes32 _peer) external onlyOwner {
        peers[_eid] = _peer;
        emit PeerSet(_eid, _peer);
    }

    /// @notice Convenience: set peer using a plain address
    function setPeerAddress(uint32 _eid, address _peer) external onlyOwner {
        bytes32 peerBytes = bytes32(uint256(uint160(_peer)));
        peers[_eid] = peerBytes;
        emit PeerSet(_eid, peerBytes);
    }

    // ─── Sending ──────────────────────────────────────────────────────────────

    /**
     * @notice Quote the native fee required to send a message.
     * @param _dstEid   Destination endpoint ID
     * @param _message  The string message to send
     * @param _options  LayerZero executor options (use buildOptions() result or pass hex from JS)
     */
    function quoteSend(
        uint32 _dstEid,
        string calldata _message,
        bytes calldata _options
    ) external view returns (uint256 nativeFee) {
        bytes memory payload = abi.encode(_message);
        MessagingParams memory params = MessagingParams({
            dstEid: _dstEid,
            receiver: peers[_dstEid],
            message: payload,
            options: _options,
            payInLzToken: false
        });
        MessagingFee memory fee = endpoint.quote(params, address(this));
        return fee.nativeFee;
    }

    /**
     * @notice Send a string message to a peer OApp on another chain.
     * @param _dstEid   Destination endpoint ID
     * @param _message  The string message
     * @param _options  LayerZero executor options
     */
    function sendMessage(
        uint32 _dstEid,
        string calldata _message,
        bytes calldata _options
    ) external payable {
        require(peers[_dstEid] != bytes32(0), "OApp: peer not set");

        bytes memory payload = abi.encode(_message);

        MessagingParams memory params = MessagingParams({
            dstEid: _dstEid,
            receiver: peers[_dstEid],
            message: payload,
            options: _options,
            payInLzToken: false
        });

        MessagingFee memory fee = endpoint.quote(params, address(this));
        require(msg.value >= fee.nativeFee, "OApp: insufficient fee");

        MessagingReceipt memory receipt = endpoint.send{value: fee.nativeFee}(
            params,
            msg.sender  // refund excess to sender
        );

        emit MessageSent(_dstEid, _message, fee.nativeFee);
    }

    // ─── Receiving ────────────────────────────────────────────────────────────

    /**
     * @notice Called by the LayerZero endpoint when a message arrives.
     *         The endpoint verifies authenticity before calling this.
     */
    function lzReceive(
        Origin calldata _origin,
        bytes32 /*_guid*/,
        bytes calldata _message,
        address /*_executor*/,
        bytes calldata /*_extraData*/
    ) external onlyEndpoint {
        // Verify the sender is a trusted peer
        require(peers[_origin.srcEid] == _origin.sender, "OApp: untrusted sender");

        string memory decoded = abi.decode(_message, (string));
        lastReceivedMessage = decoded;
        lastSrcEid = _origin.srcEid;

        emit MessageReceived(_origin.srcEid, _origin.sender, decoded);
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    /// @notice Withdraw any accidentally sent ETH/RBTC
    function withdraw() external onlyOwner {
        payable(owner).transfer(address(this).balance);
    }

    receive() external payable {}
}
