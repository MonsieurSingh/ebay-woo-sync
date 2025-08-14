import { woo } from "./woo.js";
import { LIMIT } from "../utils/constants.js";

/**
 * @param {number} [perPage=100]
 * @returns {Promise<Array>}
 * @throws {Error}
 */

function validatePerPage(perPage) {
	if (perPage < 1 || perPage > 100) {
		throw new Error("perPage must be between 1 and 100");
	}
}

function applyLimit(perPage) {
	if (LIMIT && perPage > LIMIT) {
		return LIMIT;
	}
	return perPage;
}

async function fetchWooProductsPage(page, perPage) {
	const res = await woo.get("products", { per_page: perPage, page });
	return res.data || [];
}

export async function fetchAllWooProducts(perPage = 100) {
	validatePerPage(perPage);
	perPage = applyLimit(perPage);

	let page = 1;
	const all = [];
	while (true) {
		if (LIMIT && all.length >= LIMIT) break;
		const items = await fetchWooProductsPage(page, perPage);
		all.push(...items);
		console.log(`Fetched ${items.length} products (page ${page})`);
		if (items.length < perPage) break;
		page++;
	}
	return all;
}
