import { getEbayUserClient } from "./client.js";
import { EBAY_BASE } from "../utils/constants.js";
import { withRetries } from "../utils/retry.js";

export async function reFetchOffersForSKU(sku) {
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

export async function createOfferForSKU({ sku, payload }) {
	const url = `${EBAY_BASE}/sell/inventory/v1/offer`;
	const ebayUser = getEbayUserClient();
	const createResp = await withRetries(() => ebayUser.post(url, payload), {
		label: `create offer ${sku}`,
	});
	console.log(`✅ Created offer ${createResp.data.offerId} for SKU ${sku}`);
	return createResp.data.offerId;
}

export async function updateOfferForSKU({ sku, offerId, payload }) {
	const url = `${EBAY_BASE}/sell/inventory/v1/offer/${offerId}`;
	const ebayUser = getEbayUserClient();
	await withRetries(() => ebayUser.put(url, payload), {
		label: `update offer ${sku}`,
	});
	console.log(`✅ Updated offer ${offerId} for SKU ${sku}`);
	return offerId;
}

export async function publishOfferForSKU({ sku, offerId }) {
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
