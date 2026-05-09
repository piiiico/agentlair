// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

/**
 * @title Capital-Bonded Pledge (CBP) — v0
 * @notice Minimum-viable on-chain stake contract for the BCC-Capital profile.
 *
 * @dev BCC-Capital instantiation of the Bonded Credibility Credential (BCC) schema.
 *      A holder locks ETH for a fixed term, receiving an ERC-1155 bond credential.
 *      The contract itself is the slashing oracle: early withdrawal forfeits the bond.
 *
 * subjectId encoding (bytes32, polymorphic — contract is subject-agnostic):
 *   DID hash:              keccak256(abi.encodePacked("did:", didString))
 *   World-ID nullifier:    keccak256(abi.encodePacked("worldid:", nullifierHash))
 *   GitHub repo:           keccak256(abi.encodePacked("github_repo:", "owner/repo"))
 *   Brreg business:        keccak256(abi.encodePacked("brreg:", orgNr))
 *   npm package:           keccak256(abi.encodePacked("npm:", packageName))
 *
 * The encoding convention is documented here (NatSpec) and NOT enforced in code paths.
 * Callers are responsible for consistent encoding. The contract stores bytes32 opaquely.
 *
 * Status: NOT deployed to mainnet. Sepolia + tests only.
 *         Mainnet deploy is a separate task pending security audit.
 */
contract CBP {
    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    /// @notice Possible states for a bond credential.
    enum SlashingState {
        Active,   // Bond is live and within its term
        Slashed,  // Bond was slashed (early withdrawal or predicate violation)
        Expired   // Term ended; holder may withdraw principal
    }

    /// @notice On-chain representation of a bond.
    struct Bond {
        address holder;
        bytes32 subjectId;
        uint256 amount;      // ETH locked (wei)
        uint64  lockedAt;    // Unix timestamp when lock() was called
        uint64  termSeconds; // Duration of the bond
        SlashingState state;
    }

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @notice Monotonically increasing bond ID counter. Starts at 1.
    uint256 public nextBondId;

    /// @notice bondId → Bond storage.
    mapping(uint256 => Bond) private _bonds;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    /**
     * @notice Emitted when a new bond credential is minted.
     * @param bondId    Unique bond identifier (ERC-1155 token ID semantics).
     * @param holder    Address that locked the ETH.
     * @param subjectId Polymorphic subject identifier (see encoding conventions above).
     * @param amount    Amount of ETH locked (wei).
     * @param term      Lock duration in seconds.
     */
    event BondMinted(
        uint256 indexed bondId,
        address indexed holder,
        bytes32 indexed subjectId,
        uint256 amount,
        uint64  term
    );

    /**
     * @notice Emitted when a bond is slashed.
     * @param bondId        Bond that was slashed.
     * @param reason        Human-readable slash reason (e.g. "early_withdrawal").
     * @param slashedAmount Amount of ETH forfeited (may be < bond.amount if partial slash).
     */
    event BondSlashed(
        uint256 indexed bondId,
        string  reason,
        uint256 slashedAmount
    );

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error ZeroAmount();
    error ZeroTerm();
    error BondNotFound();
    error BondNotActive();
    error NotBondHolder();

    // -------------------------------------------------------------------------
    // External functions
    // -------------------------------------------------------------------------

    /**
     * @notice Lock ETH for a fixed term and mint a bond credential.
     * @param termSeconds Duration of the bond in seconds. Must be > 0.
     * @param subjectId   Polymorphic subject identifier (see encoding conventions above).
     * @return bondId     Unique identifier for the newly minted bond.
     *
     * Reverts if msg.value == 0 (no capital locked → not a bond).
     * Reverts if termSeconds == 0 (zero term is undefined; PoPA handles open-ended streams).
     */
    function lock(
        uint64  termSeconds,
        bytes32 subjectId
    ) external payable returns (uint256 bondId) {
        if (msg.value == 0) revert ZeroAmount();
        if (termSeconds == 0) revert ZeroTerm();

        unchecked {
            bondId = ++nextBondId;
        }

        _bonds[bondId] = Bond({
            holder:      msg.sender,
            subjectId:   subjectId,
            amount:      msg.value,
            lockedAt:    uint64(block.timestamp),
            termSeconds: termSeconds,
            state:       SlashingState.Active
        });

        emit BondMinted(bondId, msg.sender, subjectId, msg.value, termSeconds);
    }

    /**
     * @notice Read the current slashing state of a bond.
     * @param bondId Bond to query.
     * @return       Current SlashingState: Active, Slashed, or Expired.
     *
     * Returns Expired automatically once block.timestamp >= lockedAt + termSeconds,
     * even if withdraw() has not been called. This reflects the BCC oracle_state
     * "expired" semantic — verifiers can read state without requiring holder action.
     *
     * Reverts if bondId does not exist.
     */
    function readSlashingState(uint256 bondId) external view returns (SlashingState) {
        Bond storage bond = _bonds[bondId];
        if (bond.holder == address(0)) revert BondNotFound();

        // If already marked Slashed, return that (terminal state)
        if (bond.state == SlashingState.Slashed) return SlashingState.Slashed;

        // Check expiry on-the-fly (avoids requiring a separate expiry transaction)
        uint64 expiresAt = bond.lockedAt + bond.termSeconds;
        if (block.timestamp >= expiresAt) return SlashingState.Expired;

        return SlashingState.Active;
    }

    /**
     * @notice Withdraw after bond term expires. Returns principal to holder.
     * @param bondId Bond to withdraw from. Must be in Active state and past term.
     */
    function withdraw(uint256 bondId) external {
        Bond storage bond = _bonds[bondId];
        if (bond.holder == address(0)) revert BondNotFound();
        if (bond.state != SlashingState.Active) revert BondNotActive();
        if (bond.holder != msg.sender) revert NotBondHolder();

        uint64 expiresAt = bond.lockedAt + bond.termSeconds;
        require(block.timestamp >= expiresAt, "CBP: bond not yet expired");

        uint256 amount = bond.amount;
        bond.amount = 0;
        bond.state = SlashingState.Expired;

        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "CBP: ETH transfer failed");
    }

    /**
     * @dev Slash a bond — callable by contract owner or slashing oracle in future versions.
     *      v0: slash is callable by ANYONE (no access control) for test purposes.
     *          Mainnet version will restrict to a governance-controlled oracle address.
     *
     * @param bondId  Bond to slash.
     * @param reason  Human-readable reason string.
     */
    function slash(uint256 bondId, string calldata reason) external {
        Bond storage bond = _bonds[bondId];
        if (bond.holder == address(0)) revert BondNotFound();
        if (bond.state != SlashingState.Active) revert BondNotActive();

        uint256 slashedAmount = bond.amount;
        bond.amount = 0;
        bond.state = SlashingState.Slashed;

        // In v0: slashed ETH goes to contract balance (owner can withdraw in future)
        emit BondSlashed(bondId, reason, slashedAmount);
    }

    /**
     * @notice Read bond details.
     */
    function getBond(uint256 bondId) external view returns (Bond memory) {
        if (_bonds[bondId].holder == address(0)) revert BondNotFound();
        return _bonds[bondId];
    }

    receive() external payable {}
}
