# SHERLOG VLAK – PWA (Web Bluetooth)

Webová aplikace pro Chrome na Androidu, která se přes Bluetooth LE připojí k jednotce SHERLOG VLAK
(služby 5400–5408 dle specifikace z 15. 3. 2026) a zobrazuje její data.

## Nasazení na GitHub Pages
1. Na GitHubu vytvořte nový repozitář (např. `sherlog-vlak`).
2. Nahrajte do něj všechny soubory z této složky (Add file → Upload files).
3. Settings → Pages → Source: *Deploy from a branch*, větev `main`, složka `/ (root)` → Save.
4. Po chvíli běží aplikace na `https://<účet>.github.io/sherlog-vlak/`.
5. V Chrome na Androidu otevřete adresu → menu ⋮ → *Přidat na plochu / Instalovat aplikaci*.

## Předpoklady (k ověření s vývojářem FW)
- Vícebajtové hodnoty little-endian (lze přepnout v Nastavení).
- Prázdný slot 5401–5408 = TIMESTAMP 0 nebo RADKOD 0.
- ZAM_RSSI_BGR kódováno stejně jako RX_RSSI (offset −32 dBm).
- NOMOVE/NOPOS/NOSEEN: 1 bajt = nelineární, 2 bajty = lineární sekundy.
- SOS = přepnutí bitu 12 v ZAM_FLAGS (0031), ostatní bity se zachovají.
