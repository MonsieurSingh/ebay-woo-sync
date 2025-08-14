<?php
// ebay-oauth-callback.php

// 1. Get the code from the URL
if (!isset($_GET['code'])) {
    die("No code received");
}

$code = $_GET['code'];

// 2. Exchange code for refresh token
$clientId = 'UrnsRUs-Sandboxw-PRD-c812e667d-30341ba1';
$clientSecret = 'PRD-812e667d22ad-f981-4c5e-97c2-78f9';
$redirectUri = 'Urns_R_Us-UrnsRUs-Sandbox-uupndoj';

$authHeader = base64_encode("$clientId:$clientSecret");

$postData = http_build_query([
    'grant_type' => 'authorization_code',
    'code' => $code,
    'redirect_uri' => $redirectUri
]);

$ch = curl_init('https://api.ebay.com/identity/v1/oauth2/token');
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "Content-Type: application/x-www-form-urlencoded",
    "Authorization: Basic $authHeader"
]);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, $postData);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);

$response = curl_exec($ch);
if ($response === false) {
    die("cURL error: " . curl_error($ch));
}
curl_close($ch);

// 3. Parse and save the tokens
$data = json_decode($response, true);
if (isset($data['refresh_token'])) {
    // echo the refresh token in to h1
    echo "<h1>Refresh token is: " . htmlspecialchars($data['refresh_token']) . "</h1>";
    echo "<h1>Refresh token saved!</h1>";
} else {
    echo "<h1>Failed to get refresh token</h1>";
    echo "<pre>" . htmlspecialchars($response) . "</pre>";
}