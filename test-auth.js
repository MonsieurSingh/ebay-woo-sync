// test-auth.js
import dotenv from "dotenv";
import { EBAY_BASE } from "./utils/constants.js";
dotenv.config();
import { refreshAppEbayToken, refreshEbayToken } from "./ebay/client.js";

async function testAuth() {
	try {
		console.log("Testing App Authentication...");
		const appToken = await refreshAppEbayToken();
		console.log("✅ App Token:", appToken.slice(0, 25) + "...");

		console.log("\nTesting User Authentication...");
		const userToken = await refreshEbayToken();
		console.log("✅ User Token:", userToken.slice(0, 25) + "...");
	} catch (error) {
		console.error("❌ Authentication Failed:");
		console.error("Status:", error.response?.status);
		console.error("Error:", error.response?.data || error.message);

		// Detailed diagnostics
		console.log("\nDiagnostics:");
		console.log(
			"Client ID:",
			process.env.EBAY_CLIENT_ID ? "Exists" : "MISSING"
		);
		console.log(
			"Client Secret:",
			process.env.EBAY_CLIENT_SECRET ? "Exists" : "MISSING"
		);
		console.log(
			"Refresh Token:",
			process.env.EBAY_REFRESH_TOKEN ? "Exists" : "MISSING"
		);
		console.log("EBAY_BASE:", EBAY_BASE);
	}
}

testAuth();
