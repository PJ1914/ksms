# Testing the app on your phone

Plain steps for running KSMS on an Android phone with **Expo Go**. No emulator is needed.

## One-time setup

1. On the phone, install **Expo Go** from the Play Store. It must support Expo SDK 58.
2. Connect the phone and the PC to the **same Wi-Fi network**.
3. Find the PC's Wi-Fi address: open PowerShell, run `ipconfig`, and look for **IPv4 Address** under _Wireless LAN adapter Wi-Fi_, for example `192.168.1.10`.
4. Put that address in `apps/mobile/.env`. This file is not committed to git.

   ```
   EXPO_PUBLIC_API_URL=http://192.168.1.10:3000/api/v1
   ```

   If the router later gives the PC a different address, update this line and restart step 2 below.

5. If Windows asks whether to allow **Node.js** on the network, click **Allow**.

## Every time

Open **two** terminals in the project folder (`e:\my projects\KSMS`):

| Terminal | Command           | Leave it running. It is ready when you see… |
| -------- | ----------------- | ------------------------------------------- |
| 1 (API)  | `pnpm dev:api`    | `API listening on port 3000`                |
| 2 (app)  | `pnpm dev:mobile` | a QR code                                   |

On the phone, open **Expo Go** and tap **Scan QR code**, then scan the code in terminal 2. The first load takes about a minute.

To check that the phone can reach the API, open `http://192.168.1.10:3000/api/v1/health` in the phone's browser. You should see `"status":"ok"`.

## What you can try (early slice)

- **Create your shop** (first time): your name, the shop name, your mobile number and a password of at least 8 characters.
- **Sign in** with your mobile number and password. Close and reopen the app: you stay signed in.
- **Stock tab**:
  - Tap **+** to add a product: give its name, choose how it is sold (kg, litre or piece) and enter its price.
  - Search the list by name or SKU.
  - Pull down to refresh.
- **More tab**: see your shop and role, and **Sign out**.

The data goes into your real Neon database.

## If something goes wrong

| You see                                | Do this                                                                                               |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| "Cannot reach the server"              | Is terminal 1 running? Is the phone on the same Wi-Fi? Is the address in `apps/mobile/.env` current?  |
| The QR code does not open              | In terminal 2 press `s` to switch to Expo Go mode. Or run `pnpm --filter @ksms/mobile start --tunnel` |
| "Too many attempts"                    | Sign-in is rate-limited for safety. Wait one minute                                                   |
| You changed `.env` and nothing changed | Stop terminal 2 (Ctrl+C) and run `pnpm dev:mobile` again; `.env` is read only at start                |
