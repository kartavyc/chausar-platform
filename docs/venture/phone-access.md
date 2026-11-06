# Phone access and phone alerts

Chausar runs on your computer. Your phone can do two things with it:

- **Get alerts** in Telegram from a bot of your own. They say how many things wait for you, nothing more unless you choose.
- **Open Chausar** in the phone's browser. On the same Wi-Fi you pair with a link. Away from home you use Tailscale.

You approve sends, payments and price changes in the Chausar app. A Telegram alert never approves anything, and it has no buttons or links. Some approvals (connecting your AI, billing settings, these phone settings) work only on the computer itself.

Both live in **Business > Notifications**, under "How alerts reach you".

## Telegram alerts

1. In Telegram, open **@BotFather**, send `/newbot` and follow its steps. It gives you a bot token. Keep it private: anyone with it can send messages as your bot.
2. Open your new bot in Telegram and press **Start** (or send it any message). A bot can only write to someone who wrote to it first.
3. Find your chat id. In a browser on your computer, open `https://api.telegram.org/bot<your token>/getUpdates` and look for `"chat":{"id":` followed by a number. That number is your chat id.
4. In Chausar, open **Telegram alerts**, paste the token and the chat id, and press **Save bot**. Chausar keeps both in your computer's protected key storage, not in the business file.
5. Press **Send a test alert**. Your phone should show "Chausar: 0 things wait for you. Open the app to decide." (or the number waiting right now).

What an alert says: `Chausar: 3 things wait for you. Open the app to decide.` That is all, by default.

**Add titles to alerts** is your choice. With it on, each alert also lists the titles of what waits, such as "Reply to the GST question". Titles can name clients, and Telegram then holds them on its servers. Leave it off if that matters to you or your clients.

Alerts follow your quiet hours, pause and pacing (10, then 30, then 60 minutes while you stay away). They come only while Chausar is running on your computer. **Remove bot** deletes the token and chat id from this computer.

## Open Chausar on your phone, same Wi-Fi

1. Connect your phone to the same Wi-Fi as your computer.
2. In Chausar, open **Phone access** and press **Make a pairing link**.
3. Scan the QR code with the phone's camera, or send the link to yourself and open it on the phone. It looks like `http://192.168.1.20:43117/#pair=...`.
4. The link works **once**, within **10 minutes**. The phone then stays paired for 12 hours.

The first time, Windows may ask whether Chausar can use private networks. Allow **private networks** only.

Good to know:

- Only devices on your home network (or Tailscale) can reach it. Everything else is refused before it is read.
- The connection on your Wi-Fi is plain http. Use it on your own Wi-Fi with a password, not on cafe or office Wi-Fi.
- Refreshing the page on the phone ends that pairing. Make a new link.
- **Stop phone access** closes it and ends every paired phone at once. Quitting Chausar closes it too.

## Away from home: Tailscale

Tailscale makes a small private network between your own devices, encrypted end to end. Chausar does not need any open port on your router. The free Personal plan is enough.

1. Install Tailscale on your computer from tailscale.com/download, and sign in.
2. Install the Tailscale app on your phone and sign in with the **same account**.
3. Check that both show as connected in the Tailscale app. Your computer gets an address starting with `100.`.
4. In Chausar, open **Phone access**. Once Tailscale is running on the computer, a **Link for Tailscale** button appears. Press it.
5. Open the link on your phone (Tailscale must be on there too). The same rules hold: one use, 10 minutes, then 12 hours paired.

If **Link for Tailscale** does not appear, Tailscale is not running on the computer, or it has no `100.` address yet. Open the Tailscale app on the computer and connect.

Your computer must be on and Chausar running for the phone to reach it. If the laptop sleeps, the phone loses it until it wakes.

## What stays on the computer

A phone opened this way gets the same Chausar, with one rule: anything the app keeps to the computer stays there. That includes connecting or changing your AI, writing a new plan, billing and payment settings, and these phone and Telegram settings. The phone shows "Approve this inside the Chausar app." for those.
