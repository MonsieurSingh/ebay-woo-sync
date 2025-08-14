#!/usr/bin/env node
/**
 * Bulk sync WooCommerce -> eBay (Inventory Items, optional Offers, optional Publish)
 * Usage examples:
 *   node bulk-sync.js                       # Inventory items only (safe default)
 *   node bulk-sync.js --offers              # Create/Update offers too (requires location)
 *   node bulk-sync.js --offers --publish    # Publish offers after creating/updating
 *   node bulk-sync.js --dry-run             # Show what would happen, make no changes
 *   node bulk-sync.js --page-size 50        # Pull Woo products 50 at a time
 *   node bulk-sync.js --limit 10            # Limit to first 10 products (for testing)
 *   node bulk-sync.js --offers --limit 5 --dry-run # Test offers creation
 */

import dotenv from "dotenv";
import pLimit from "p-limit";
import { getEbayUserClient, getEbayAppClient } from "./ebay/client.js";
import { withRetries } from "./utils/retry.js";
import { ensureLocation } from "./ebay/location.js";
import {
	LIMIT,
	DRY_RUN,
	CREATE_OFFERS,
	PUBLISH_OFFERS,
	PAGE_SIZE,
	EBAY_ENV,
	EBAY_MARKETPLACE_ID,
	EBAY_CURRENCY,
} from "./utils/constants.js";
import { fetchAllWooProducts } from "./woo/pagination.js";
import { upsertInventoryItemFromWoo } from "./woo/upsert.js";
import {
	suggestCategoryForProduct,
	validateCategoryId,
} from "./ebay/taxonomy.js";
import {
	reFetchOffersForSKU,
	createOfferForSKU,
	updateOfferForSKU,
	publishOfferForSKU,
} from "./ebay/offer-api.js";
import { upsertOfferForSKU } from "./ebay/offer-workflow.js";

dotenv.config();

async function main() {
	console.log(`\n=== Woo ⟶ eBay Bulk Sync ===
Env: ${EBAY_ENV}, Marketplace: ${EBAY_MARKETPLACE_ID}, Currency: ${EBAY_CURRENCY}
Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}
Offers: ${CREATE_OFFERS ? "ON" : "OFF"}  Publish: ${
		PUBLISH_OFFERS ? "ON" : "OFF"
	}\n`);

	// 1) Auth eBay early to fail-fast
	console.log("🔄 Authenticating eBay...");
	const ebayUser = getEbayUserClient();
	console.log("🔄 Authenticating eBay app...");
	const ebayApp = getEbayAppClient();
	console.log("🔄 eBay auth complete.");

	// 2) (If offers) ensure we have a location
	let locationKey = null;
	if (CREATE_OFFERS) {
		locationKey = await ensureLocation();
	}
	console.log(
		`🔄 Using location key: ${locationKey || "none (offers disabled)"}`
	);

	// 3) Fetch all Woo products
	let products = await fetchAllWooProducts(PAGE_SIZE);
	if (LIMIT > 0) {
		console.log(
			`⚠️ Limiting run to first ${LIMIT} products (for testing).`
		);
		products = products.slice(0, LIMIT);
	}
	console.log(`Total Woo products: ${products.length}`);

	// Concurrency limiter to be nice to APIs
	const limit = pLimit(4);

	let created = 0,
		skipped = 0,
		offers = 0,
		published = 0;

	// We’ll only handle "simple" products here. Variations can be added later.
	const simples = products.filter(
		(p) => p.type === "simple" || p.variations?.length === 0
	);
	const others = products.length - simples.length;
	if (others > 0) {
		console.warn(`ℹ️  ${others} non-simple products detected (variable/grouped). This script currently treats only simple products.
Add variation support later if you need multi-variation listings.`);
	}
	// (async () => {
	// 	console.log(
	// 		"DEBUG: checking category",
	// 		process.env.EBAY_URNS_FOR_ASHES_CATEGORY_ID
	// 	);
	// 	const cid = process.env.EBAY_URNS_FOR_ASHES_CATEGORY_ID;
	// 	if (cid) {
	// 		const v = await validateCategoryId(cid).catch((e) => {
	// 			console.error(
	// 				"validateCategoryId failed:",
	// 				e.response?.data || e.message
	// 			);
	// 			return null;
	// 		});
	// 		console.log("validateCategoryId result:", v);
	// 	} else {
	// 		console.warn("No EBAY_URNS_FOR_ASHES_CATEGORY_ID set");
	// 	}

	// 	// test suggestion
	// 	const s = await suggestCategoryForProduct(
	// 		"Keepsake Urn Heart Small",
	// 		EBAY_MARKETPLACE_ID
	// 	).catch((e) => {
	// 		console.error(
	// 			"suggestCategoryForProduct failed:",
	// 			e.response?.data || e.message
	// 		);
	// 		return null;
	// 	});
	// 	console.log("suggested category:", s);
	// })();

	const tasks = simples.map((prod) =>
		limit(async () => {
			try {
				const invRes = await upsertInventoryItemFromWoo(prod);
				if (invRes.status.startsWith("skipped")) {
					skipped++;
					return;
				}
				created++;
				if (CREATE_OFFERS) {
					const offerRes = await upsertOfferForSKU({
						sku: invRes.sku,
						wooProduct: prod,
						locationKey,
					});
					offers++;
					if (offerRes.status === "published") published++;
				}
			} catch (err) {
				console.error(
					`❌ Failed for SKU ${prod.sku || "(no sku)"}:`,
					err.response?.data || err.message
				);
			}
		})
	);

	await Promise.all(tasks);

	console.log(`\n=== Summary ===
Inventory upserted: ${created}
Skipped (no sku/images): ${skipped}
Offers processed: ${offers}
Published: ${published}
Done.\n`);
}

main().catch((err) => {
	console.error("Fatal:", err.response?.data || err.message);
	process.exit(1);
});
