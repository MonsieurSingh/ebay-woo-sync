import dotenv from "dotenv";
import { getEbayUserClient } from "./token.js";
import { withRetries } from "../utils/retry.js";
import { DRY_RUN, EBAY_BASE } from "../utils/constants.js";

dotenv.config({ path: "../.env" });

const locationKey = process.env.EBAY_LOCATION_KEY;

function buildLocationBody() {
	return {
		merchantLocationKey: process.env.EBAY_LOCATION_KEY,
		name: process.env.EBAY_SHIP_NAME,
		locationTypes: ["STORE", "WAREHOUSE"],
		phone: process.env.EBAY_SHIP_PHONE,
		address: {
			addressLine1: process.env.EBAY_SHIP_ADDRESS_LINE1,
			city: process.env.EBAY_SHIP_CITY,
			stateOrProvince: process.env.EBAY_SHIP_STATE,
			postalCode: process.env.EBAY_SHIP_POSTCODE,
			country: process.env.EBAY_SHIP_COUNTRY,
		},
		operatingHours: [],
	};
}

async function getLocation() {
	const ebayUser = getEbayUserClient();
	const locUrl = `${EBAY_BASE}/sell/inventory/v1/location/${encodeURIComponent(
		locationKey
	)}`;
	const getResp = await ebayUser.get(locUrl);
	return getResp.data.merchantLocationKey;
}

async function createLocationIfMissing() {
	const body = buildLocationBody();
	console.log(`➕ Creating eBay location ${locationKey}...`);
	const ebayUser = getEbayUserClient();
	await withRetries(
		() =>
			ebayUser.post(
				`/sell/inventory/v1/location/${encodeURIComponent(
					locationKey
				)}`,
				body
			),
		{ label: "create location" }
	);
	console.log(`✅ Created eBay location: ${locationKey}`);
	return locationKey;
}

export async function ensureLocation() {
	const existingLocation = await getLocation();
	if (existingLocation) {
		console.log(`✅ Using existing eBay location: ${existingLocation}`);
		return existingLocation;
	}

	if (DRY_RUN) {
		const body = buildLocationBody();
		console.log(
			`🧪 [dry-run] Would create eBay location ${locationKey}`,
			body
		);
		return locationKey;
	}
	return await createLocationIfMissing();
}
