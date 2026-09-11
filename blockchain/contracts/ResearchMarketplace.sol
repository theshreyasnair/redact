// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ResearchMarketplace
 * @notice Marketplace for selling research findings. Content is delivered
 *         off-chain (paid via x402); this contract records listings,
 *         purchases, disputes, and seller reputation. Listings are
 *         multi-sale: many buyers can purchase the same listing, and each
 *         purchase carries its own dispute state.
 */
contract ResearchMarketplace is Ownable {
    enum ListingStatus {
        Active,
        Delisted
    }

    enum PurchaseStatus {
        None,
        Completed,
        Disputed,
        Resolved
    }

    struct Listing {
        uint256 id;
        address seller;
        bytes32 contentHash;
        string title;
        string description;
        string category;
        uint256 price;
        uint256 timestamp;
        ListingStatus status;
    }

    struct Purchase {
        uint256 timestamp;
        PurchaseStatus status;
    }

    struct SellerReputation {
        uint256 totalSales;
        uint256 totalDisputes;
        uint256 disputesLost;
    }

    uint256 public constant DISPUTE_WINDOW = 7 days;

    /// @notice Backend address authorized to record x402 purchases.
    address public recorder;

    uint256 public listingCount;

    mapping(uint256 => Listing) public listings;
    mapping(address => SellerReputation) public sellerReputations;

    /// @notice Purchases per listing per buyer: listingId => buyer => purchase.
    mapping(uint256 => mapping(address => Purchase)) public purchases;

    event ListingCreated(
        uint256 indexed listingId,
        address indexed seller,
        bytes32 contentHash,
        string title,
        string category,
        uint256 price
    );
    event PurchaseRecorded(uint256 indexed listingId, address indexed buyer, uint256 timestamp);
    event DisputeOpened(uint256 indexed listingId, address indexed buyer);
    event DisputeResolved(uint256 indexed listingId, address indexed buyer, bool buyerWins);
    event ListingDelisted(uint256 indexed listingId, address indexed seller);
    event RecorderUpdated(address indexed oldRecorder, address indexed newRecorder);

    modifier onlyRecorder() {
        require(msg.sender == recorder, "Not authorized recorder");
        _;
    }

    constructor(address _recorder) Ownable(msg.sender) {
        require(_recorder != address(0), "Recorder is zero address");
        recorder = _recorder;
    }

    function setRecorder(address _recorder) external onlyOwner {
        require(_recorder != address(0), "Recorder is zero address");
        emit RecorderUpdated(recorder, _recorder);
        recorder = _recorder;
    }

    function createListing(
        bytes32 contentHash,
        string calldata title,
        string calldata description,
        string calldata category,
        uint256 price
    ) external returns (uint256 listingId) {
        require(contentHash != bytes32(0), "Empty content hash");
        require(bytes(title).length > 0, "Empty title");
        require(price > 0, "Price must be > 0");

        listingId = ++listingCount;

        listings[listingId] = Listing({
            id: listingId,
            seller: msg.sender,
            contentHash: contentHash,
            title: title,
            description: description,
            category: category,
            price: price,
            timestamp: block.timestamp,
            status: ListingStatus.Active
        });

        emit ListingCreated(listingId, msg.sender, contentHash, title, category, price);
    }

    /// @notice Called by the backend after an x402 payment succeeds.
    function recordPurchase(uint256 listingId, address buyer) external onlyRecorder {
        Listing storage listing = listings[listingId];
        require(listing.id != 0, "Listing does not exist");
        require(buyer != address(0), "Buyer is zero address");
        require(listing.status == ListingStatus.Active, "Listing not active");
        require(buyer != listing.seller, "Seller cannot buy own listing");
        require(purchases[listingId][buyer].status == PurchaseStatus.None, "Already purchased");

        purchases[listingId][buyer] = Purchase({
            timestamp: block.timestamp,
            status: PurchaseStatus.Completed
        });
        sellerReputations[listing.seller].totalSales += 1;

        emit PurchaseRecorded(listingId, buyer, block.timestamp);
    }

    /// @notice Seller pulls their listing from sale. Existing purchases and
    ///         their dispute windows are unaffected.
    function delist(uint256 listingId) external {
        Listing storage listing = listings[listingId];
        require(listing.id != 0, "Listing does not exist");
        require(msg.sender == listing.seller, "Only seller can delist");
        require(listing.status == ListingStatus.Active, "Listing not active");

        listing.status = ListingStatus.Delisted;

        emit ListingDelisted(listingId, msg.sender);
    }

    /// @notice Buyer may dispute their own purchase within 7 days of buying.
    function openDispute(uint256 listingId) external {
        Listing storage listing = listings[listingId];
        require(listing.id != 0, "Listing does not exist");

        Purchase storage purchase = purchases[listingId][msg.sender];
        require(purchase.status == PurchaseStatus.Completed, "No disputable purchase");
        require(block.timestamp <= purchase.timestamp + DISPUTE_WINDOW, "Dispute window closed");

        purchase.status = PurchaseStatus.Disputed;
        sellerReputations[listing.seller].totalDisputes += 1;

        emit DisputeOpened(listingId, msg.sender);
    }

    /// @notice Owner/arbitrator resolves a buyer's open dispute.
    function resolveDispute(uint256 listingId, address buyer, bool buyerWins) external onlyOwner {
        Listing storage listing = listings[listingId];
        require(listing.id != 0, "Listing does not exist");

        Purchase storage purchase = purchases[listingId][buyer];
        require(purchase.status == PurchaseStatus.Disputed, "No open dispute");

        purchase.status = PurchaseStatus.Resolved;
        if (buyerWins) {
            sellerReputations[listing.seller].disputesLost += 1;
        }

        emit DisputeResolved(listingId, buyer, buyerWins);
    }

    function getSellerReputation(address seller) external view returns (SellerReputation memory) {
        return sellerReputations[seller];
    }

    function getListing(uint256 listingId) external view returns (Listing memory) {
        require(listings[listingId].id != 0, "Listing does not exist");
        return listings[listingId];
    }

    function getPurchase(uint256 listingId, address buyer) external view returns (Purchase memory) {
        return purchases[listingId][buyer];
    }
}
