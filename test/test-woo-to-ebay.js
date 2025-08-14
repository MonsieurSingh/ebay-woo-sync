// test-woo-to-ebay.js
import dotenv from "dotenv";
import axios from "axios";
import WooCommerceRestApi from "@woocommerce/woocommerce-rest-api";
import { refreshEbayToken } from "../refresh-ebay-token.js";

dotenv.config();

const woo = new WooCommerceRestApi.default({
	url: process.env.WOO_URL,
	consumerKey: process.env.WOO_CONSUMER_KEY,
	consumerSecret: process.env.WOO_CONSUMER_SECRET,
	version: "wc/v3",
});

const authBase64 = Buffer.from(
	`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`
).toString("base64");

(async () => {
	try {
		// 1. Get Woo product
		const wooRes = await woo.get("products", { per_page: 1 });
		const product = wooRes.data[0];
		console.log("Using Woo product:", product.name, "SKU:", product.sku);

		// 2. Get eBay token
		const token = await refreshEbayToken();

		// 3. Create inventory item
		const invUrl =
			process.env.EBAY_ENV === "sandbox"
				? `https://api.sandbox.ebay.com/sell/inventory/v1/inventory_item/${encodeURIComponent(
						product.sku
				  )}`
				: `https://api.ebay.com/sell/inventory/v1/inventory_item/${encodeURIComponent(
						product.sku
				  )}`;

		const body = {
			sku: product.sku,
			product: {
				title: product.name,
				description: product.short_description || product.description,
				imageUrls: product.images.map((img) => img.src),
			},
		};

		const resp = await axios.put(invUrl, body, {
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				"Content-Language": "en-AU",
			},
		});

		console.log("✅ Created/updated inventory item:", resp.status);
	} catch (err) {
		console.error("❌ Failed:", err.response?.data || err.message);
	}
})();
