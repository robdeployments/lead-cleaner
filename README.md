# Lead Cleaner

Turns bulky property / skip-trace exports into a clean, import-ready contact list.

Point it at one or more CSV exports and it writes `<name>_clean.csv` (and/or
`<name>_clean.xlsx`) containing exactly eight columns:

```
First Name, Last Name, Email, Phone, Address, City, State, Postal Code
```

## How a row is built

**Phone.** Every `Contact#_Phone#` column on the row is collected and normalised to
10 US digits. Repeats within the same row are dropped. The number with the most
recent `LastSeen` date wins; column order breaks ties. Rows with no usable number
are dropped, and if the same number turns up again only the first row is kept.

**Name.** Taken from the contact block the winning phone belongs to, so the name
and the number always describe the same person. If that block has no name it falls
back to another contact, then to `Owner 1`, `Owner 2`, and finally to a business
name. Listing and selling agent columns are never used.

**Email.** The winning contact's own `Email1`, then `Email2`. By default an email is
not pulled off a different contact block, because that address belongs to someone
else. The "Use another contact's email" setting turns that borrowing on.

**Address.** The property address, not the mailing address.

Values wrapped by exporters as `="(703) 439-9049"` are unwrapped, and names stored
in ALL CAPS are re-cased (`MCDONALD` becomes `McDonald`).

## Settings

Saved between launches, in `settings.json` under the app's user-data folder.

| Setting | Default | What it does |
|---|---|---|
| Output folder | Downloads | Where the cleaned files land |
| Save as | CSV | CSV, Excel, or both |
| Phone format | `+17034399049` | Also digits-only or `(703) 439-9049` |
| Remove rows with no phone number | on | Drops rows with nothing to call |
| Remove duplicate phone numbers | on | Keeps the first row for each number |
| Dedupe across every file in the batch | on | Off dedupes each file on its own |
| Remove numbers flagged Do Not Call | **off** | DNC numbers are kept unless you turn this on |
| Use another contact's email | off | Fills more rows, at the cost of mismatched emails |

An existing `_clean` file is never overwritten; a timestamp is added instead.

## Which files it reads

Any CSV with `Contact<n>_Phone<m>` columns. The header is read at run time, so the
number of contacts and phones per contact does not matter, gaps in the numbering
are fine, and variants like `Contact1_First` or `Property Address` are recognised.
Files with no phone columns are flagged in the file list and skipped.

## Phone numbers

Input is read in whatever shape the export happens to use: `+1`, `1`, `00` or
`011` prefixes, parentheses, spaces, dots, slashes or dashes in any combination,
trailing extensions, Excel's numeric mangling (`7034399049.0`,
`7.034399049e+09`), and cells holding more than one number. Anything that is not
a dialable North American number is rejected, including service codes such as
411 and 911 and any non-US number, and the row falls through to its next
available phone.

Output is always the same shape: `+1703 439 9049`.

## Installing

Neither build is signed by a paid certificate, so both operating systems warn once.

**macOS.** Open the `.dmg`, drag the app to Applications, launch it, and when the
warning appears go to System Settings > Privacy & Security, scroll to Security and
click **Open Anyway**. Right-click > Open no longer works on macOS 15 and later.
To skip the warning entirely, clear the download flag first:

```
xattr -dr com.apple.quarantine "/Applications/Lead Cleaner.app"
```

**Windows.** Run the installer; at "Windows protected your PC" click **More info**
then **Run anyway**.

## Running and building

```
npm install
npm start          # run it
npm run dist:mac   # build the .dmg
npm run dist:win   # build the Windows installer
npm run dist:all   # both
```

Builds are written to `~/.lead-cleaner-build` and the installers are then copied
into `dist/`. The output has to live outside `~/Documents` and `~/Desktop`: those
are iCloud File Provider domains, which stamp `com.apple.FinderInfo` onto app
bundles, and `codesign` refuses to sign anything carrying it. The attribute cannot
be removed from a directory with `xattr -d`, so relocating the build is the fix.

`scripts/afterPack.js` then ad-hoc signs the macOS bundle and verifies the result,
failing the build if it is bad. Without that step electron-builder leaves Electron's
original linker signature in place after renaming the bundle, and macOS reports the
app as **"damaged and can't be opened"** with no way past it. A real Developer ID
certificate, once configured, signs over the ad-hoc signature.

`node selftest.js <file.csv>` runs the real pipeline against a file and checks the
output, without opening the window.

### If `npm install` leaves Electron unpacked

npm may skip Electron's postinstall. Then:

```
node node_modules/electron/install.js
```
