// test-ebay.js

import dotenv from "dotenv";
dotenv.config();
import axios from "axios";
import { refreshEbayToken } from "../refresh-ebay-token.js";

async function testEbay() {
	let token;
	let invUrl;
	let response;
	let limit;

	try {
		token = await refreshEbayToken();
		if (!token) throw new Error("Failed to refresh eBay token");
		invUrl =
			"https://api.ebay.com/sell/inventory/v1/inventory_item?limit=1";
		response = await axios.get(invUrl, {
			headers: {
				Authorization: `Bearer ${token}`,
			},
		});
		console.log("✅ eBay API connected. Inventory sample:", response.data);
	} catch (err) {
		console.error(
			"❌ eBay connection failed:",
			err.response?.data || err.message
		);
	}
}

testEbay();
