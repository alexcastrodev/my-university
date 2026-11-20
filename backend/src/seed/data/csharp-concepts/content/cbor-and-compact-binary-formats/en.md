---
version: 1.0
updatedAt: 2026-11-20
---
## Objective

CBOR (RFC 8949) is JSON's data model with a binary encoding: numbers, text
strings, arrays and maps, plus byte strings, tags and a precise size for every
integer. It is the encoding of CoAP in IoT, of COSE (signed and encrypted
messages) and of WebAuthn passkeys: the `attestationObject` and the public
key a passkey registers are both CBOR. .NET ships it as the `System.Formats.Cbor`
package (a low-level `CborWriter` and `CborReader`, no object mapper) and COSE as
`System.Security.Cryptography.Cose`. This concept measures the bytes: how each
integer, float and string is encoded, the same object in JSON, CBOR,
MessagePack and Protobuf, what `CborConformanceMode` really changes, the
.NET 11 incremental reader fed chunk by chunk, and a COSE_Sign1 message signed
and verified with an ES256 key generated at run time (no key printed).

Versions: .NET SDK 11.0.100, runtime 11.0.0, TFM `net11.0`,
`System.Formats.Cbor` 11.0.0, `System.Security.Cryptography.Cose` 11.0.0,
`MessagePack` 2.5.307, `Google.Protobuf` 3.36.1, macOS arm64. For .NET 10 the
packages are the 10.0.x line (I ran 10.0.15 on SDK 10.0.100).

## Use Cases

- Compact, schema-light messages for constrained devices and CoAP, where
  JSON's field names and base64 cost too many bytes.
- Signing a small payload with COSE_Sign1 (a CBOR array carrying the payload
  and a signature) instead of building a JWT.
- Reading or building WebAuthn data on a relying-party server: the
  `attestationObject` and the COSE_Key of the credential public key.

## Deep Dive

### The encoding, byte by byte

Each CBOR item starts with one byte: the top 3 bits are the major type, the
low 5 bits are the value or the size of the length that follows. `CborWriter`
chooses the smallest form, and the output matches the RFC 8949 Appendix A
vectors:

```text
int 0: 00                  int 23: 17                 int 24: 1818
int 255: 18ff              int 256: 190100            int 65536: 1a00010000
int 4294967296: 1b0000000100000000                    int -1: 20      int -25: 3818
text "IETF": 6449455446    bytes 01020304: 4401020304
[1,[2,3],[4,5]]: 8301820203820405                     (spec: 8301820203820405)
tag 1 epoch 1363896240: c11a514b67b0                  (spec: c11a514b67b0)
```

0 to 23 fit in the initial byte, then 1, 2, 4 and 8 extra bytes. Negative `n`
is stored as `-1 - n` in major type 1, so `-1` is `20`. A tag is major type 6
wrapping the next item: `WriteUnixTimeSeconds` writes tag 1 (`c1`) plus an
integer, `WriteDateTimeOffset` writes tag 0 and an ISO 8601 text string (`c074...`).
`CborTag` names the registered tags (`UnixTimeSeconds`, `Uri`, `Base64Url`...).

Floats are shrunk. `WriteDouble(21.5)` produced `f94d60`, a half-precision
float of 3 bytes, while `WriteDouble(1.1)` stayed `fb3ff199999999999a`, 9
bytes, because 1.1 is not exact in smaller widths. This held in `Lax`, `Strict`
and `Canonical`; `Ctap2Canonical` gave `fb4035800000000000` for 21.5 (the docs
say it keeps float representations). `ReadDouble()` accepts all three widths,
which `PeekState()` reports separately.

### One object in four formats

A sensor reading with an int, a short string, a double, a bool, an array of five
ints, a 16-byte blob and a timestamp, each written as compactly as the library
allows:

```text
JSON 131 bytes (System.Text.Json, blob as base64)
CBOR with text keys 84 bytes
CBOR with integer keys 54 bytes
MessagePack with string keys 89 bytes, with array form 52 bytes
Protobuf (field numbers) 55 bytes
```

And 100 such readings in one array: JSON 12618, CBOR text keys 8589, CBOR
integer keys 5589, MessagePack string keys 8503, Protobuf 5400. The map is the
cost: every record repeats seven field names, and dropping them (CBOR integer
keys, MessagePack array form, Protobuf field numbers) is what gets near 55
bytes, about 40% of the JSON size. That is the system design lesson of the
[data encoding formats](/system-design/system-design-concepts/data-encoding-formats-and-schema-evolution)
concept in numbers: CBOR with text keys is a smaller JSON, not a schema format.
Part of the 84 versus 89 gap is the half-precision `celsius` (3 bytes against 9
in MessagePack). I wrote the Protobuf bytes with the low-level `CodedOutputStream`
(no `.proto` file, no `protoc`). These are sizes, not speed: nothing was benchmarked.

### Reading: PeekState and a strict state machine

`ReadStartMap()` returned 7, then a loop of `ReadTextString()` for the key and a
`switch (r.PeekState())` for the value:

```text
map(7): id=42(UnsignedInteger) device=sensor-7(TextString) celsius=21,5(HalfPrecisionFloat)
ok=True(Boolean) samples=[1,2,3,100,1000](StartArray) blob=bytes[16](ByteString) ts=1763600000(UnsignedInteger)
after map: Finished
```

`CborReader` is a forward-only cursor like `Utf8JsonReader` (see the
[source generation and Utf8JsonReader](/csharp-concepts/system-text-json-source-generation-and-utf8jsonreader)
concept): call the read that matches the next item or get an
`InvalidOperationException` ("the next CBOR data item is of major type '7'").
There is no object mapper, so mapping to a type is your code. Truncated input
throws `CborContentException` ("Declared definite length of CBOR data item
exceeds available buffer size").

### Conformance modes and key order

| Mode | What it adds (docs and my runs) |
|---|---|
| `Lax` | well-formed only; duplicate keys and unsorted maps are read |
| `Strict` | rejects duplicate keys (`CborContentException`), requires valid UTF-8 |
| `Canonical` | RFC 7049 3.9: map keys sorted, integers shortest, no indefinite length |
| `Ctap2Canonical` | the CTAP2 rules: also no tags, floats untouched |

The writer sorts keys for you in the canonical modes. Text keys written as
`bb, a, aa, c`:

```text
Lax             a46262620161610262616103616304   (bb, a, aa, c: as written)
Canonical       a46161026163046261610362626201   (a, c, aa, bb)
```

Integer keys written as `-2, 3, -1` came out as `3, -1, -2` (`a3030020002100`)
in `Canonical` and `Ctap2Canonical`. The order is of the encoded bytes
(shorter first, then bytewise): `03`, then `20`, then `21`. It matters because
a signature covers bytes, so encoders that order keys differently sign
different bytes for the same data. The reader checks too: `Canonical` on
`{"bb":1,"a":2}` threw "CBOR keys not sorted in accordance with conformance
mode 'Canonical'". Indefinite-length items (`9f 01 02 ff`) read
fine in `Lax` and `Strict`, threw in `Canonical`, and a writer with
`convertIndefiniteLengthEncodings: true` rewrote them as `820102`. The package
documents the RFC 7049 and CTAP2 canonical rules; RFC 8949 later defined
deterministic encoding, and I did not test how the two differ.

### Reading incrementally (.NET 11)

.NET 11 adds `CborReaderOptions` (`ConformanceMode`, `AllowMultipleRootLevelValues`,
`MaxDepth`), a constructor with `isFinalBlock` and `CborReader.SlideData`, to
read a payload that arrives in chunks. The 84-byte object above, fed 1, 3 and 7
bytes at a time, decoded to the identical result each time:

```text
chunk 1: slides=83, id=42 device=sensor-7 celsius=21,5 ok=True samples=[1,2,3,100,1000] ...
chunk 3: slides=27, same result      chunk 7: slides=11, same result
```

```csharp
while (r.PeekState() == CborReaderState.NeedsMoreData)
{   // keep the unread tail, append the next chunk
    var left = buf.Slice(buf.Length - r.BytesRemaining);
    buf = Concat(left, nextChunk);
    r.SlideData(buf, isFinalBlock: last);
}
```

`PeekState()` returned `NeedsMoreData` also when an item was cut in the middle
(a text string split across chunks), so the unread tail has to be carried over;
the docs sample omits that (its comment says buffer management is omitted).
`Strict` and `Canonical` reject a non-final block with an `ArgumentException`
("only supported in the 'Lax' conformance mode"), so streaming gives up
validation. On the 10.0.15 package `CborReaderOptions` and `SlideData` do not
exist (CS0246, CS1061), and the writer produced the same bytes on both versions.

### COSE_Sign1: a signed CBOR message

```csharp
using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
var signer = new CoseSigner(key, HashAlgorithmName.SHA256);
byte[] msg = CoseSign1Message.SignEmbedded(payload, signer);
bool ok = CoseMessage.DecodeSign1(msg).VerifyEmbedded(key);   // ECDsa, public part used
```

```text
signed: 84 bytes, header: d28443a10126a04a68656c6c6f20 ...
structure: tag 18, array(4), protected bstr 3 bytes, unprotected map(0), payload bstr 10 bytes, signature bstr 64 bytes
alg header (label 1) = -7; raw protected = a10126; content = hello cose
verify with public key: True   with another key: False
flip last signature bit: False   flip one payload bit (decoded "hemlo cose"): False
detached: 74 bytes, verify with payload True, with a different payload False
external AAD: verify with same True, without False
```

`d2` is tag 18 (COSE_Sign1), `84` an array of four: the protected headers as a
byte string holding `a10126` (the map `{1: -7}`, algorithm ES256), an empty
unprotected map, the payload as a byte string and the 64-byte signature. The
whole message is 84 bytes for a 10-byte payload, with no base64. `SignDetached` leaves the payload out (74 bytes) and you supply it to
`VerifyDetached`; the external AAD is context that is signed but not
transmitted. `Decode` does not verify: a tampered payload decoded fine and
only `Verify*` failed, so never trust `Content` before verifying. `CoseKey`
(from an `ECDsa` or `RSA`) also works in the verify overloads, and its `MLDsa`
constructor is `[Experimental]` with diagnostic `SYSLIB5006` (read by
reflection, not run). `CoseMultiSignMessage` (several signers) was not measured.

### Bridge: passkeys and the identity track

A passkey registration returns an `attestationObject`, a CBOR map with `fmt`,
`attStmt` and `authData`, and `authData` ends with the credential public key as
a COSE_Key. I wrote that key shape with `CborWriter` in `Ctap2Canonical` mode,
adding the keys in the "wrong" order (`-3, 3, -2, 1, -1`) from an ES256 key I
generated:

```text
COSE_Key 77 bytes, first 10: a5010203262001215820
key order on the wire: 1,3,-1,-2,-3
```

That is the 77 bytes and the `a501020326200121582051cf...` prefix that the
[WebAuthn, FIDO2 and passkeys](/identity-concepts/webauthn-fido2-and-passkeys-concepts)
concept measured in a registration ceremony, where its Node server decodes with a
30-line hand-written codec. On a .NET relying party you would use `CborReader`
for the attestation object. I did not parse a real attestation object here,
only built the key map and compared its shape with that concept. The canonical
mode is what keeps the key order fixed.

### Book vs today

Older books teach ASN.1 with BER/DER for signed structures (X.509, CMS), then
MessagePack as "the binary JSON" and Protobuf as "the schema format". ASN.1
still carries certificates; the others each kept a niche: Protobuf (and gRPC)
for service contracts with generated code, MessagePack as a drop-in binary
JSON, CBOR where a standard already chose it (CoAP, COSE, CWT, WebAuthn).
Size rarely decides: CBOR with text keys (84 bytes) and MessagePack with string
keys (89) are within 5 bytes, and only dropping the keys moves the needle (54,
52 and 55).

## Trade-offs

- **Low-level only.** `CborWriter` and `CborReader` give exact control and
  bytes you can check against the RFC, but you write the mapping, with no
  `Serialize<T>`. For POCOs, MessagePack or `System.Text.Json` is faster to write.
- **Keys cost more than the encoding.** Text keys made CBOR 84 bytes against 54
  with integer keys, so a compact CBOR protocol picks small integer labels (as COSE
  does) and loses readability.
- **Canonical modes are strict on purpose.** They throw on indefinite lengths
  and unsorted maps, `Ctap2Canonical` also on tags and it keeps doubles at 9
  bytes. Pick the mode the spec you implement names.
- **Streaming needs `Lax`.** Incremental reading gave up `Strict` validation:
  validate the finished buffer separately if the source is untrusted.
- **Decoding is not verifying.** COSE `DecodeSign1` reads without checking a
  signature, so verify before using the content, and bind context with the
  external AAD.

## Documentation Links

- [System.Formats.Cbor Namespace, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.formats.cbor) (doc)
- [CborWriter Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.formats.cbor.cborwriter) (doc)
- [CborReader Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.formats.cbor.cborreader) (doc)
- [CborConformanceMode Enum, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.formats.cbor.cborconformancemode) (doc)
- [CoseSign1Message Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.cose.cosesign1message) (doc)
- [What's new in .NET 11 libraries, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-11/libraries) (doc)
- [RFC 8949, Concise Binary Object Representation (CBOR), IETF](https://www.rfc-editor.org/rfc/rfc8949) (doc)
- [RFC 9052, CBOR Object Signing and Encryption (COSE): Structures and Process, IETF](https://www.rfc-editor.org/rfc/rfc9052) (doc)
- [Web Authentication Level 3, W3C](https://www.w3.org/TR/webauthn-3/) (doc)
