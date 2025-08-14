import { getEbayAppClient } from "./client.js";
import { withRetries } from "../utils/retry.js";
import { EBAY_BASE, EBAY_MARKETPLACE_ID } from "../utils/constants.js";

export async function getDefaultCategoryTreeId(marketplaceId) {
	const ebayApp = getEbayAppClient();
	const url = `${EBAY_BASE}/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${encodeURIComponent(
		marketplaceId
	)}`;
	const resp = await withRetries(() => ebayApp.get(url), {
		label: "getDefaultCategoryTreeId",
	});
	return resp.data.categoryTreeId;
}

async function fetchCategorySuggestions(title, treeId) {
	const ebayApp = getEbayAppClient();
	const q = encodeURIComponent(title.slice(0, 250)); // short, safe
	const url = `${EBAY_BASE}/commerce/taxonomy/v1/category_tree/${encodeURIComponent(
		treeId
	)}/get_category_suggestions?q=${q}`;
	const resp = await withRetries(() => ebayApp.get(url, { params: { q } }), {
		label: "get_category_suggestions",
	});
	return resp.data;
}

function extractBestCategorySuggestion(data) {
	const suggestions =
		data?.categorySuggestions || data?.categorySuggestionsList || [];
	if (suggestions.length) {
		const best = suggestions[0];
		const categoryId = best?.category?.categoryId || best?.categoryId;
		const displayName =
			best?.category?.categoryName ||
			best?.category?.categoryNameLocal ||
			best?.categoryId;
		return { categoryId, displayName };
	}
	return null;
}

export async function suggestCategoryForProduct(
	title,
	marketplaceId = EBAY_MARKETPLACE_ID
) {
	try {
		const treeId = await getDefaultCategoryTreeId(marketplaceId);
		const data = await fetchCategorySuggestions(title, treeId);
		const bestSuggestion = extractBestCategorySuggestion(data);
		if (bestSuggestion) {
			console.log(
				`🔎 Taxonomy suggestion: ${bestSuggestion.categoryId} (${bestSuggestion.displayName}) for "${title}"`
			);
			return bestSuggestion.categoryId;
		}
		console.warn(`🔎 No category suggestions for "${title}"`);
		return null;
	} catch (err) {
		console.warn(
			"🔎 Category suggestion failed:",
			err.response?.data || err.message
		);
		return null;
	}
}

export async function validateCategoryId(
	categoryId,
	marketplaceId = EBAY_MARKETPLACE_ID
) {
	try {
		const ebayApp = getEbayAppClient();
		const treeId = await getDefaultCategoryTreeId(marketplaceId);
		const url = `/commerce/taxonomy/v1/category_tree/${treeId}/get_category_subtree`;

		const resp = await ebayApp.get(url, {
			params: { category_id: categoryId },
		});

		return !!(resp.data?.categorySubtreeNode || resp.data?.category);
	} catch (err) {
		const status = err.response?.status;
		const errId = err.response?.data?.errors?.[0]?.errorId;
		if (status === 403 || errId === 1100) {
			console.warn(
				`⚠️ Taxonomy validation for ${categoryId} returned 403/1100 (insufficient permissions).`
			);
			return null;
		}
		if (status === 400 || status === 404) return false;
		throw err;
	}
}

// export async function validateCategoryId(
// 	categoryId,
// 	marketplaceId = EBAY_MARKETPLACE_ID
// ) {
// 	if (!categoryId) return false;
// 	try {
// 		const token = await getAppEbayToken();
// 		const treeId = await getDefaultCategoryTreeId(marketplaceId);
// 		const url = `${EBAY_BASE}/commerce/taxonomy/v1/category_tree/${encodeURIComponent(
// 			treeId
// 		)}/get_category_subtree?category_id=${encodeURIComponent(categoryId)}`;
// 		const resp = await withRetries(
// 			() =>
// 				axios.get(url, {
// 					headers: { Authorization: `Bearer ${token}` },
// 				}),
// 			{ label: `validate category ${categoryId}` }
// 		);
// 		const valid = !!(
// 			resp.data &&
// 			(resp.data.categorySubtreeNode || resp.data.category)
// 		);
// 		return valid;
// 	} catch (err) {
// 		const status = err.response?.status;
// 		const errId = err.response?.data?.errors?.[0]?.errorId;
// 		if (status === 403 || errId === 1100) {
// 			console.warn(
// 				`⚠️ Taxonomy validation for ${categoryId} returned 403/1100 (insufficient permissions).`
// 			);
// 			return null;
// 		}
// 		if (status === 400 || status === 404) return false;
// 		throw err;
// 	}
// }

// export async function validateCategoryId(
// 	categoryId,
// 	marketplaceId = EBAY_MARKETPLACE_ID
// ) {
// 	if (!categoryId) return false;

// 	try {
// 		const ebayApp = getEbayAppClient();

// 		// ensure client has a timeout to fail fast
// 		ebayApp.defaults.timeout = ebayApp.defaults.timeout || 15000;

// 		const treeId = await getDefaultCategoryTreeId(marketplaceId);
// 		if (!treeId) {
// 			console.warn(
// 				`⚠️ No category tree id for marketplace ${marketplaceId}`
// 			);
// 			return false;
// 		}

// 		const path = `/commerce/taxonomy/v1/category_tree/${encodeURIComponent(
// 			treeId
// 		)}/get_category_subtree`;
// 		console.log(
// 			`🔄 Validating category ${categoryId} in tree ${treeId} (path: ${path})`
// 		);

// 		const resp = await withRetries(
// 			() => ebayApp.get(path, { params: { category_id: categoryId } }),
// 			{ label: `validate category ${categoryId}` }
// 		);

// 		console.log(`✅ validateCategoryId response status=${resp.status}`);
// 		console.log(`🔄 Category ${categoryId} data:`, resp.data);

// 		const valid = !!(
// 			resp.data &&
// 			(resp.data.categorySubtreeNode || resp.data.category)
// 		);
// 		return valid;
// 	} catch (err) {
// 		console.error(
// 			`❌ validateCategoryId(${categoryId}) failed:`,
// 			err.response?.status,
// 			err.response?.data || err.message
// 		);
// 		const status = err.response?.status;
// 		const errId = err.response?.data?.errors?.[0]?.errorId;
// 		if (status === 403 || errId === 1100) {
// 			console.warn(
// 				`⚠️ Taxonomy validation for ${categoryId} returned 403/1100 (insufficient permissions).`
// 			);
// 			return null;
// 		}
// 		if (status === 400 || status === 404) return false;
// 		throw err;
// 	}
// }
