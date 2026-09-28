# In-house Dialer (WebRTC + FreePBX/Asterisk)

Browser based dialer jo apne PBX (FreePBX/Asterisk) se WebRTC ke through connect hota hai.
Status: **dialer + multi-user login ready. PBX server aur SIP trunk abhi baaki hai.**

```
Browser (dialer + login)  --WSS-->  FreePBX/Asterisk (AWS)  --SIP trunk-->  Telecom provider  -->  Phone network
```

## Files
- `server.js` : backend (login, users, call history)
- `public/index.html` : dialer (login ke baad khulta hai)
- `public/admin.html` : admin panel, yahan se aap user ID/password banate ho
- `.env.example` : settings ka sample (asli `.env` GitHub par mat daalna)

## Multi-user login kaise kaam karta hai
1. Aap (admin) `/admin.html` se har user ke liye **User ID + Password** banate ho
2. Har user ko ek **PBX extension** assign hota hai (FreePBX me pehle wo extension banao, phir yahan number aur uska password daalo)
3. User `/` par apni ID/password se login karta hai; server uske extension ki details browser ko deta hai aur dialer PBX se connect ho jata hai
4. Har user ki call history alag rehti hai. Admin kabhi bhi password reset, extension change, disable ya delete kar sakta hai

Login passwords bcrypt se hash hote hain. Login par rate limit hai (10 attempts / 15 min).

## Chalana (server par)
```
npm install
cp .env.example .env    # values bharo, phir:
export $(grep -v '^#' .env | xargs) && npm start
```
Pehla admin login `ADMIN_USER` / `ADMIN_PASS` (.env) se banta hai. Phir `/admin.html` par jaake users banao.
HTTPS zaroori hai (mic access ke liye): Nginx + Let's Encrypt ke peeche `localhost:3000` ko proxy karo.
Iske liye Node.js 18+ chahiye. Ye same AWS server par (PBX ke saath) ya alag chhote server par chal sakta hai.

## GitHub par code rakhna
Repo me ye files upload karo (`node_modules`, `.env`, `dialer.db` nahi, `.gitignore` inhe rok deta hai).
**GitHub Pages par ye poora app nahi chalega**, kyunki login ke liye backend server chahiye. GitHub sirf code store karega; live apne AWS server par hoga.

---

## Step 1: AWS account aur server

1. aws.amazon.com par account banao (email, phone, debit/credit card chahiye; verification ke liye chhota charge lag sakta hai)
2. Region: **Asia Pacific (Mumbai) ap-south-1** (India ke liye lowest latency)
3. Sabse aasan: **Amazon Lightsail** > Create instance
   - Linux, OS only: **Debian 12** (ya Ubuntu 22.04)
   - Plan: minimum 2 vCPU / 4 GB RAM
4. **Static IP** attach karo (Lightsail > Networking > Create static IP). Bina static IP ke SIP kaam nahi karega.
5. Firewall (Networking tab) me ye ports kholo:
   - TCP 22 (SSH), TCP 80 and 443 (web)
   - TCP 8089 (WSS for WebRTC)
   - UDP 5060 (SIP), UDP 10000-20000 (audio)
   - Behtar: 22 aur admin panel sirf apne IP se allow karo
6. Ek **domain/subdomain** lo (jaise `pbx.yourdomain.com`) aur uska A record static IP par point karo. WebRTC ke liye valid HTTPS/WSS certificate chahiye, jo domain ke bina nahi milta.

## Step 2: SIP trunk (real phone calls ke liye)

India me PSTN se jodne ke liye licensed telecom provider se hi trunk milta hai. Khud ka bana nahi sakte.

1. 2 se 3 providers se quote lo: **Airtel (Smartflo/IQ), Tata Tele Business, Vodafone Idea Business, Jio Business, Ozonetel, Exotel, Knowlarity** (Exotel/Knowlarity se sirf SIP trunk mang sakte ho)
2. Poochne wali baatein:
   - SIP trunk (IP-based ya registration-based) milega?
   - DID/virtual number ka charge, aur per-minute rate (outbound/inbound)
   - Concurrent call channels kitne
   - Static IP whitelisting chahiye? (AWS ka static IP dena hoga)
   - Codec: G.711 (alaw/ulaw) support
3. KYC documents (aam taur par): company/GST ya proprietor proof, PAN, address proof, authorised signatory ID
4. **Compliance:** marketing/promotional calls ke liye TRAI ke rules lagte hain (telemarketer registration, 140 series numbers, DND scrub, consent). Sirf transactional/service calls ho to bhi provider se confirm kar lo ki aapka use-case allowed hai. SMS ke liye alag DLT-linked gateway lagega (DLT se calls nahi hoti).
5. Provider se ye mil jayega: SIP host/IP, port, username/password (ya IP auth), DID number

## Step 3: FreePBX install

SSH karke (Debian 12, root/sudo):
```
apt update && apt upgrade -y
cd /usr/src
wget https://github.com/FreePBX/sng_freepbx_debian_install/raw/master/sng_freepbx_debian_install.sh -O sng_freepbx_debian_install.sh
bash sng_freepbx_debian_install.sh
```
Install me 30 se 60 minute lag sakte hain. Phir browser me `http://<static-ip>` kholo aur admin user banao.
(Script ka URL FreePBX ke official docs se verify kar lena; version/URL badal sakta hai.)

## Step 4: PBX setup

1. **Trunk:** Connectivity > Trunks > Add SIP (PJSIP) Trunk, provider ki details daalo
2. **Outbound route:** Connectivity > Outbound Routes, dial pattern ke saath us trunk ko jodo
3. **Inbound route:** DID number ko apne extension par route karo
4. **Extension:** Applications > Extensions > Add PJSIP extension (jaise 1001), strong secret rakho
5. **WebRTC:** Extension > Advanced me "Enable AVPF", "Enable ICE Support", "Media Encryption: DTLS" set karo (ya WebRTC template use karo)
6. **HTTPS/WSS:** Admin > Certificate Management > Let's Encrypt se certificate lo, phir Settings > Asterisk SIP Settings > Chan PJSIP me WSS/8089 enable karo
7. Apply Config

## Step 5: Dialer se connect

`.env` me `SIP_WSS=wss://pbx.yourdomain.com:8089/ws` aur `SIP_DOMAIN=pbx.yourdomain.com` daalo. Phir dialer par user login karo (uska extension admin panel me set hona chahiye) aur number dial karke Call.

## Aage ke kaam
- SMS module (DLT-linked SMS gateway API ke saath)
- Login system, contacts, call recording, reports
- Backend (Node/Python) jo PBX ke logs (CDR) padhe

Security: `.env` ya credentials GitHub par push mat karo. PBX par Fail2ban lagao, default passwords badlo, aur admin panel ko public internet par khula mat chhodo.
