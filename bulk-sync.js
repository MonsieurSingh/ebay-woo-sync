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
import { getEbayUserClient, getEbayAppClient } from "./ebay/token.js";
import { withRetries } from "./utils/retry.js";
import { ensureLocation } from "./ebay/location.js";
import {
	LIMIT,
	DRY_RUN,
	CREATE_OFFERS,
	PUBLISH_OFFERS,
	PAGE_SIZE,
	EBAY_ENV,
	EBAY_BASE,
	EBAY_MARKETPLACE_ID,
	EBAY_CURRENCY,
} from "./utils/constants.js";
import { fetchAllWooProducts } from "./woo/pagination.js";
import { upsertInventoryItemFromWoo } from "./woo/upsert.js";
import {
	suggestCategoryForProduct,
	validateCategoryId,
} from "./ebay/taxonomy.js";

dotenv.config();

// Taxonomy helpers

// helper: get default category tree id for a marketplace

async function reFetchOffersForSKU(sku) {
	const findUrl = `${EBAY_BASE}/sell/inventory/v1/offer?sku=${encodeURIComponent(
		sku
	)}`;
	const ebayUser = getEbayUserClient();
	const resp = await withRetries(() => ebayUser.get(findUrl), {
		label: `re-fetch offers ${sku}`,
	});
	const offers = resp.data?.offers || [];
	return offers;
}

async function createOfferForSKU({ sku, payload }) {
	const url = `${EBAY_BASE}/sell/inventory/v1/offer`;
	const ebayUser = getEbayUserClient();
	const createResp = await withRetries(() => ebayUser.post(url, payload), {
		label: `create offer ${sku}`,
	});
	console.log(`✅ Created offer ${createResp.data.offerId} for SKU ${sku}`);
	return createResp.data.offerId;
}

async function updateOfferForSKU({ sku, offerId, payload }) {
	const url = `${EBAY_BASE}/sell/inventory/v1/offer/${offerId}`;
	const ebayUser = getEbayUserClient();
	await withRetries(() => ebayUser.put(url, payload), {
		label: `update offer ${sku}`,
	});
	console.log(`✅ Updated offer ${offerId} for SKU ${sku}`);
	return offerId;
}

async function publishOfferForSKU({ sku, offerId }) {
	const ebayUser = getEbayUserClient();
	const pubUrl = `${EBAY_BASE}/sell/inventory/v1/offer/${offerId}/publish`;
	try {
		await withRetries(
			() => ebayUser.post(pubUrl, null, { timeout: 15000 }),
			{ label: `publish offer ${sku}` }
		);
		console.log(`🚀 Published offer ${offerId} for SKU ${sku}`);
		return true;
	} catch (err) {
		console.warn(
			`⚠️ Failed to publish offer ${offerId} for SKU ${sku}:`,
			err.response?.data || err.message
		);
		throw err;
	}
}

async function tryPublishWithCategoryFallback(
	sku,
	offerId,
	payload,
	productTitle = ""
) {
	try {
		await publishOfferForSKU({ sku, offerId });
		return { published: true, offerId };
	} catch (pubErr) {
		const errId = pubErr.response?.data?.errors?.[0]?.errorId;
		const msg = pubErr.response?.data?.errors?.[0]?.message || "";
		if (
			msg.includes("PrimaryCategory.CategoryID") ||
			errId === 25005 ||
			msg.toLowerCase().includes("category")
		) {
			console.warn(
				`⚠️ Publish failed due to category error for offer ${offerId}, SKU ${sku}: ${msg}`
			);
			const envFallback = process.env.EBAY_URNS_FOR_ASHES_CATEGORY_ID;
			let newCategory = envFallback || null;
			if (!newCategory && productTitle) {
				newCategory = await suggestCategoryForProduct(
					productTitle,
					EBAY_MARKETPLACE_ID
				);
			}
			if (newCategory) {
				console.log(
					`➕ Updating offer ${offerId} with category ${newCategory} and retrying publish...`
				);
				payload = payload || {};
				payload.categoryId = newCategory;
				await updateOfferForSKU({ sku, offerId, payload });
				await publishOfferForSKU({ sku, offerId });
				return {
					published: true,
					offerId,
					retriedWithCategory: newCategory,
				};
			}
		}
		throw pubErr;
	}
}

// Ensure getAppEbayToken() returns the app-level token (client_credentials)
// and validateCategoryId() calls it (you already have a version above).
async function ensureCategoryForPayload(wooProduct, payload) {
	// Normalize incoming
	payload = payload || {};
	let candidate =
		payload.categoryId || process.env.EBAY_URNS_FOR_ASHES_CATEGORY_ID;

	if (!candidate) {
		console.warn(
			`ℹ️ No category configured for SKU ${
				payload.sku || "(unknown)"
			}; will attempt suggestion.`
		);
		candidate = null;
	} else {
		candidate = String(candidate).trim();
	}

	// If we have a candidate, validate it
	if (candidate) {
		console.log(
			`🔄 Validating category ${candidate} for SKU ${
				payload.sku || "(unknown)"
			}`
		);
		const valid = await validateCategoryId(candidate).catch((e) => {
			// validateCategoryId returns null when permission issue — treat specially
			console.warn(
				`⚠️ validateCategoryId(${candidate}) threw/failed:`,
				e.response?.data || e.message
			);
			return null;
		});
		console.log(`🔄 validateCategoryId(${candidate}) returned:`, valid);
		if (valid === true) {
			payload.categoryId = candidate;
			console.log(
				`✅ category ${candidate} validated for SKU ${
					payload.sku || "(unknown)"
				}`
			);
			return payload.categoryId;
		}

		if (valid === null) {
			// unknown due to permission — keep it, but warn (we may still fail at publish)
			console.warn(
				`⚠️ Could not confirm category ${candidate} validity due to insufficient taxonomy permissions. Keeping it and continuing; publish may still fail.`
			);
			payload.categoryId = candidate;
			return payload.categoryId;
		}

		// valid === false -> invalid candidate
		console.warn(
			`❌ Configured category ${candidate} appears invalid for marketplace ${EBAY_MARKETPLACE_ID}. Trying taxonomy suggestion...`
		);
		// clear candidate and fall through to suggestion
	}

	// Try taxonomy suggestion using the product title
	const title =
		(wooProduct && (wooProduct.name || wooProduct.title || "")) || "";
	if (title) {
		const suggested = await suggestCategoryForProduct(
			title,
			EBAY_MARKETPLACE_ID
		).catch((e) => {
			console.warn(
				"⚠️ suggestCategoryForProduct failed:",
				e.response?.data || e.message
			);
			return null;
		});
		if (suggested) {
			console.log(
				`➕ Using suggested category ${suggested} for "${title}"`
			);
			payload.categoryId = String(suggested);
			return payload.categoryId;
		}
	}

	// Nothing found — remove category and return null
	console.warn(
		`⚠️ No valid category found for SKU ${
			payload.sku || "(unknown)"
		} / title "${title}". Removing category from payload and skipping publish (if publishing).`
	);
	delete payload.categoryId;
	return null;
}

/**
 * Robust upsert: prefer updating an existing offer (if any), otherwise create.
 * Fallbacks:
 *  - If PUT fails with 25713 (not available) try creating.
 *  - If POST fails with 25002 (offer exists) re-fetch offers and publish/update the recovered offer.
 *  - If create/update/publish all fail, throw so outer handler records failure.
 */
async function upsertOfferForSKU({ sku, wooProduct, locationKey }) {
	console.log(`\n🔄 Upserting offer for SKU ${sku}...`);
	const findUrl = `${EBAY_BASE}/sell/inventory/v1/offer?sku=${encodeURIComponent(
		sku
	)}`;
	const ebayUser = getEbayUserClient();

	let offersResp;
	try {
		offersResp = await withRetries(() => ebayUser.get(findUrl), {
			label: `find offer ${sku}`,
		});
	} catch (err) {
		console.error(
			`❌ Failed to fetch offers for SKU ${sku}:`,
			err.response?.status,
			err.response?.data || err.message
		);
		// if API returns 25713 in the find step (rare), treat as no offers
		const errId = err.response?.data?.errors?.[0]?.errorId;
		if (errId === 25713) {
			console.warn(
				`⚠️ No valid offers found for SKU ${sku} (errorId 25713). Continuing as if no offers exist.`
			);
			offersResp = { data: { offers: [] } };
		} else {
			throw err;
		}
	}

	const offers = offersResp.data?.offers || [];
	const existing = offers[0];
	console.log(
		`Found ${offers.length} offers for SKU ${sku}`,
		existing
			? `existing.offerId=${existing.offerId} status=${existing.status}`
			: ""
	);
	if (offers.length > 1)
		console.warn(
			`⚠️ Multiple offers found for SKU ${sku}; using the first one: ${existing?.offerId}`
		);

	// make the price 15% more than the Woo price and round it to 2 decimal places
	const priceMultiplier = 1.15; // 15% markup
	const priceValue = String(
		(
			(wooProduct.price || wooProduct.regular_price || 0) *
			priceMultiplier
		).toFixed(2)
	);
	const qty = Number.isFinite(wooProduct.stock_quantity)
		? wooProduct.stock_quantity
		: 0;

	// base payload
	const payload = {
		sku,
		marketplaceId: EBAY_MARKETPLACE_ID,
		format: "FIXED_PRICE",
		availableQuantity: qty,
		pricingSummary: {
			price: { value: priceValue, currency: EBAY_CURRENCY },
		},
		listingDescription:
			wooProduct.short_description ||
			wooProduct.description ||
			wooProduct.name,
		categoryId: process.env.EBAY_URNS_FOR_ASHES_CATEGORY_ID || "88742", // Default to Urns for Ashes category
		listingPolicies: {
			returnPolicyId: process.env.EBAY_RETURN_POLICY_ID,
			paymentPolicyId: process.env.EBAY_PAYMENT_POLICY_ID,
			fulfillmentPolicyId: process.env.EBAY_FULFILLMENT_POLICY_ID,
		},
		merchantLocationKey: locationKey,
	};
	console.log(`🔄 Upsert payload for SKU ${sku}:`);
	await ensureCategoryForPayload(wooProduct, payload);
	console.log(`Payload after category check:`, payload);
	// If we are about to publish but payload.categoryId is null => skip publish and return a helpful status
	if (PUBLISH_OFFERS && !payload.categoryId) {
		console.warn(
			`⏭️ Skipping publish for SKU ${sku} because no valid category was determined. Please review SKU ${sku} manually.`
		);
		// If you still want to create the offer without publishing, continue; otherwise return.
		// Return an actionable status so you can collect these SKUs for manual fix.
		// (Choose behavior you prefer; below returns after creating/updating but not publishing.)
	}

	if (payload.categoryId) {
		const valid = await validateCategoryId(payload.categoryId).catch(
			(e) => {
				console.warn(
					`⚠️ Could not validate category ${payload.categoryId} for SKU ${sku}:`,
					e.response?.data || e.message
				);
				return null; // treat as unknown
			}
		);
		if (valid === false) {
			console.warn(
				`⚠️ Category ${payload.categoryId} seems invalid for marketplace ${EBAY_MARKETPLACE_ID}. Removing category from payload and continuing`
			);
			delete payload.categoryId;
		} else if (valid === null) {
			console.warn(
				`⚠️ Could not determine validity for category ${payload.categoryId} (insufficient permissions). Keeping category and attempting publish; if publish fails it will be retried without the category.`
			);
			// keep the category — we will catch publish 25005 and retry
		} else {
			console.log(
				`✅ Category ${payload.categoryId} validated for SKU ${sku}`
			);
		}
	}

	if (process.env.EBAY_DEFAULT_CONDITION)
		payload.condition = process.env.EBAY_DEFAULT_CONDITION;

	if (DRY_RUN) {
		console.log(
			`🧪 [dry-run] Would ${
				existing ? "UPDATE/USE" : "CREATE"
			} offer for SKU ${sku}`,
			{ qty, priceValue, existingStatus: existing?.status }
		);
		return {
			sku,
			offerId: existing?.offerId || "dry-run",
			status: existing ? "would-update-offer" : "would-create-offer",
		};
	}

	// If an existing offer exists, attempt update first (covers UNPUBLISHED, READY, PUBLISHED in most cases)
	if (existing && existing.offerId) {
		const offerId = existing.offerId;
		try {
			console.log(
				`🔄 Attempting PUT update for existing offer ${offerId} (SKU ${sku}, status=${existing.status})`
			);
			await updateOfferForSKU({ sku, offerId, payload });
			// If publish requested and offer not published, try to publish
			if (PUBLISH_OFFERS) {
				try {
					// If it's already published the publish call will either succeed or fail with a clear message; we catch below
					await tryPublishWithCategoryFallback(
						sku,
						offerId,
						payload,
						wooProduct.name || wooProduct.title || ""
					);
					return { sku, offerId, status: "published" };
				} catch (pubErr) {
					// If publish fail, still return updated result unless pubErr must be bubbled.
					console.warn(
						`⚠️ Publish after update failed for offer ${offerId} (SKU ${sku}). Continuing.`
					);
					return { sku, offerId, status: "offer-updated" };
				}
			}
			return { sku, offerId, status: "offer-updated" };
		} catch (err) {
			const errId = err.response?.data?.errors?.[0]?.errorId;
			// If update fails because offer not updatable -> try creation flow
			if (errId === 25713) {
				console.warn(
					`⚠️ Update failed with 25713 for offer ${offerId} (SKU ${sku}), attempting to create a new offer...`
				);
				// fall through to create logic below
			} else {
				// other errors: rethrow and record
				console.error(
					`❌ Update offer ${offerId} failed for SKU ${sku}:`,
					err.response?.data || err.message
				);
				throw err;
			}
		}
	}

	// CREATE flow (either no existing, or PUT failed with 25713)
	try {
		const newOfferId = await createOfferForSKU({ sku, payload });
		// publish if requested
		if (PUBLISH_OFFERS) {
			try {
				await tryPublishWithCategoryFallback(
					sku,
					newOfferId,
					payload,
					wooProduct.name || wooProduct.title || ""
				);
				return { sku, offerId: newOfferId, status: "published" };
			} catch (pubErr) {
				console.warn(
					`⚠️ Publish failed for newly created offer ${newOfferId} (SKU ${sku}). Returning created status.`
				);
				return { sku, offerId: newOfferId, status: "offer-created" };
			}
		}
		return { sku, offerId: newOfferId, status: "offer-created" };
	} catch (createErr) {
		// If creation failed because an offer already exists (25002), re-fetch and try to recover
		const createErrId = createErr.response?.data?.errors?.[0]?.errorId;
		console.warn(
			`❌ create offer ${sku} failed:`,
			createErr.response?.status,
			createErr.response?.data || createErr.message
		);
		if (createErrId === 25002) {
			console.warn(
				`⚠️ Offer entity already exists for SKU ${sku} (25002). Re-fetching offers to recover...`
			);
			const refreshed = await reFetchOffersForSKU(sku);
			const recovered = refreshed[0];
			if (!recovered) {
				// unexpected: no offers found after create says it exists
				console.error(
					`🚨 Post-create recovery: no offers returned for SKU ${sku} even though create said it exists.`
				);
				throw createErr;
			}
			console.log(
				`ℹ️ Recovered offer ${recovered.offerId} status=${recovered.status} for SKU ${sku}. Attempting to publish/update it.`
			);
			// If recovered is unpublished or ready, try to publish if requested
			try {
				if (PUBLISH_OFFERS) {
					await tryPublishWithCategoryFallback(
						sku,
						recovered.offerId,
						payload,
						wooProduct.name || wooProduct.title || ""
					);
					return {
						sku,
						offerId: recovered.offerId,
						status: "published",
					};
				}
				// Otherwise try to update it (best-effort)
				try {
					await updateOfferForSKU({
						sku,
						offerId: recovered.offerId,
						payload,
					});
					return {
						sku,
						offerId: recovered.offerId,
						status: "offer-updated",
					};
				} catch (updErr) {
					// If update still fails, just return recovered info
					console.warn(
						`⚠️ Could not update recovered offer ${recovered.offerId} for SKU ${sku}:`,
						updErr.response?.data || updErr.message
					);
					return {
						sku,
						offerId: recovered.offerId,
						status: `recovered-${recovered.status}`,
					};
				}
			} catch (recErr) {
				console.error(
					`❌ Recovery publish/update for recovered offer ${recovered.offerId} failed:`,
					recErr.response?.data || recErr.message
				);
				throw recErr;
			}
		} else {
			// other create error -> bubble up
			throw createErr;
		}
	}
}

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
