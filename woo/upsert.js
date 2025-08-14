import axios from "axios";
import dotenv from "dotenv";
import { getEbayUserClient } from "../ebay/token.js";
import { withRetries } from "../utils/retry.js";
import { DRY_RUN, EBAY_BASE } from "../utils/constants.js";

dotenv.config();

function getSku(prod) {
	const sku = prod.sku;
	if (!sku) {
		console.warn(`⏭️  Skipping product "${prod.name}" (no SKU)`);
		return null;
	}
	return sku;
}

function extractImageUrls(images) {
	let imageUrls = [];
	if (Array.isArray(images) && images.length) {
		imageUrls = images
			.map((i) => {
				if (typeof i === "string") return i.trim();
				if (i && (i.src || i.srcUrl)) return (i.src || i.srcUrl).trim();
				return null;
			})
			.filter(Boolean);
	} else if (typeof images === "string" && images.trim()) {
		imageUrls = images
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
	}
	return imageUrls;
}

function sanitizeImageUrls(imageUrls) {
	return imageUrls
		.map((u) => {
			if (!u) return null;
			u = u.replace(/\s+/g, "%20").trim();
			if (!/^https?:\/\//i.test(u)) return null;
			return u;
		})
		.filter(Boolean);
}

async function filterValidImages(imageUrls, sku) {
	const validImages = [];

	for (const url of imageUrls) {
		if (!url || !/^https?:\/\//i.test(url)) continue;
		try {
			let headResp;
			try {
				headResp = await axios.head(url, { timeout: 7000 });
			} catch {
				headResp = await axios.get(url, {
					timeout: 7000,
					responseType: "stream",
				});
			}

			const ctype = (
				headResp.headers["content-type"] || ""
			).toLowerCase();
			if (ctype.startsWith("image/")) {
				validImages.push(url);
			} else {
				console.warn(
					`⚠️ Skipping image for SKU ${sku}: URL does not appear to be an image (${url}) content-type=${ctype}`
				);
			}
		} catch (err) {
			console.warn(
				`⚠️ Skipping image for SKU ${sku}: unreachable (${url}) - ${err.message}`
			);
		}
	}
	return validImages;
}

function buildInventoryBody(prod, sku, imageUrls) {
	return {
		sku,
		product: {
			title: prod.name?.slice(0, 80),
			description:
				prod.short_description || prod.description || prod.name,
			imageUrls,
			aspects: {},
		},
	};
}

export async function upsertInventoryItemFromWoo(prod) {
	const sku = getSku(prod);
	let imageUrls = extractImageUrls(prod.images);

	if (!sku) return { sku: null, status: "skipped-no-sku" };
	imageUrls = sanitizeImageUrls(imageUrls);
	if (!DRY_RUN) imageUrls = await filterValidImages(imageUrls, sku);
	if (!imageUrls.length) {
		console.warn(
			`⏭️  Skipping SKU ${sku} (no valid images after sanitisation)`
		);
		return { sku, status: "skipped-no-images" };
	}
	const body = buildInventoryBody(prod, sku, imageUrls);
	const url = `${EBAY_BASE}/sell/inventory/v1/inventory_item/${encodeURIComponent(
		sku
	)}`;
	if (DRY_RUN) {
		console.log(
			`🧪 [dry-run] Would PUT InventoryItem for SKU ${sku} with ${imageUrls.length} images`
		);
		return { sku, status: "dry-run" };
	}
	const ebayUser = getEbayUserClient();
	await withRetries(() => ebayUser.put(url, body), {
		label: `put inventory item ${sku}`,
	});
	return { sku, status: "upserted" };
}
