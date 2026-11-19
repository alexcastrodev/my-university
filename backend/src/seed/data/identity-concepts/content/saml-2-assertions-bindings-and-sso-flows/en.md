---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

SAML 2.0 is browser SSO over signed XML: an identity provider (IdP) vouches for
a user to a service provider (SP) with an XML Assertion, carried through the
browser by Redirect and POST bindings. It predates OIDC and still runs most
enterprise and university logins. This lesson reads the protocol on the wire
against a local Keycloak acting as the IdP: the AuthnRequest and Response
decoded from base64 and deflate, the Assertion annotated element by element, the
XMLDSig signature, and the SP's mandatory checks, each failed on purpose.
A toy verifier shows the XML Signature Wrapping class. The real SP is 40 lines
wiring Node's `@node-saml/node-saml`, installed in a scratchpad folder outside
this repo, so the measured checks are a maintained library's, not mine.
Versions: Keycloak 26.8.2 (`quay.io/keycloak/keycloak:26.8.2`, `start-dev`),
Node 22.23.4, `@node-saml/node-saml` 5.2.0 (`xml-crypto` 6.4.0, `@xmldom/xmldom`
0.8.15), curl 8.7.1, OASIS SAML 2.0 OS specs.

## Use Cases

- Integrating with an enterprise or SaaS IdP (Okta, Entra, Keycloak, Shibboleth) that speaks SAML, not OIDC.
- Reviewing an SP that trusts an assertion after checking only the signature.
- Debugging "works from the IdP portal, fails from the app" (IdP-initiated versus SP-initiated).
- Deciding SAML versus OIDC for a new integration.

## Deep Dive

### Roles and the two flows

Three parties: the **user** (browser), the **IdP** that authenticates and issues
assertions, the **SP** that consumes them. **SP-initiated**: the user hits the
SP, the SP sends an `AuthnRequest` with a random `ID`, the IdP later returns a
`Response` whose `InResponseTo` echoes that `ID`. **IdP-initiated**: the user
starts at the IdP portal and the IdP posts an unsolicited `Response` with no
`InResponseTo`. That missing field is the whole risk: nothing ties the assertion
to a request this SP made, so a captured IdP-initiated response can be replayed
or injected. SAML Profiles section 4.1.4.2 lets the SP skip the `InResponseTo`
check only for the unsolicited case; the OWASP cheat sheet advises disabling
IdP-initiated SSO where possible.

### SP-initiated: the Redirect binding (measured)

The SP's `/login` 302-redirects the browser to the IdP with the request in the
URL. The `SAMLRequest` is raw-DEFLATE compressed then base64 then URL-encoded
(Bindings spec section 3.4.4.1); 954 bytes of XML become about 607 in the query.
Inflated:

```xml
<samlp:AuthnRequest ID="_e4b44d3a..." Version="2.0" IssueInstant="2026-11-19T05:43:58.922Z"
   ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
   Destination="http://localhost:6360/realms/demo/protocol/saml"
   AssertionConsumerServiceURL="http://localhost:6361/acs">
  <saml:Issuer>http://localhost:6361/sp</saml:Issuer>
  <samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" AllowCreate="true"/>
  <samlp:RequestedAuthnContext Comparison="exact">
    <saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef>
  </samlp:RequestedAuthnContext>
</samlp:AuthnRequest>
```

`Issuer` is the SP's `entityID`, `Destination` the IdP endpoint, `ProtocolBinding`
asks the IdP to return over POST. The IdP authenticates the user (a password
form here) and answers.

### The POST binding and the Response (measured)

The IdP returns an HTML page that auto-submits a form to the SP's
AssertionConsumerService. The `SAMLResponse` is base64 only, no deflate (Bindings
spec section 3.5.4), plus `RelayState` carrying the SP's deep link:

```html
<form name="saml-post-binding" method="post" action="http://localhost:6361/acs">
  <input name="SAMLResponse" value="PHNhbWxwOlJlc3BvbnNlIHhtbG5z..."/>
  <input name="RelayState" value="/reports"/>
```

Decoded (abridged), Keycloak signed both the `Response` and the `Assertion`:

```xml
<samlp:Response Destination="http://localhost:6361/acs" ID="ID_a52c..." InResponseTo="_e4b44d3a..." ...>
  <saml:Issuer>http://localhost:6360/realms/demo</saml:Issuer>
  <dsig:Signature>...signs Reference URI="#ID_a52c..."...</dsig:Signature>
  <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
  <saml:Assertion ID="ID_a6e4..." IssueInstant="2026-11-19T05:43:59.319Z">
    <saml:Issuer>http://localhost:6360/realms/demo</saml:Issuer>
    <dsig:Signature>...signs Reference URI="#ID_a6e4..."...</dsig:Signature>
    <saml:Subject>
      <saml:NameID Format="...emailAddress">alice@example.org</saml:NameID>
      <saml:SubjectConfirmation Method="...cm:bearer">
        <saml:SubjectConfirmationData InResponseTo="_e4b44d3a..."
           NotOnOrAfter="2026-11-19T05:48:57Z" Recipient="http://localhost:6361/acs"/>
      </saml:SubjectConfirmation>
    </saml:Subject>
    <saml:Conditions NotBefore="2026-11-19T05:43:57Z" NotOnOrAfter="2026-11-19T05:44:57Z">
      <saml:AudienceRestriction><saml:Audience>http://localhost:6361/sp</saml:Audience></saml:AudienceRestriction>
    </saml:Conditions>
    <saml:AuthnStatement AuthnInstant="...59Z" SessionIndex="54Dwn..." SessionNotOnOrAfter="...15:43:59Z">
      <saml:AuthnContext><saml:AuthnContextClassRef>...ac:classes:unspecified</saml:AuthnContextClassRef></saml:AuthnContext>
    </saml:AuthnStatement>
    <saml:AttributeStatement>
      <saml:Attribute Name="email">...alice@example.org...</saml:Attribute>
      <saml:Attribute Name="Role">...finance-approver...</saml:Attribute>
    </saml:AttributeStatement>
  </saml:Assertion>
</samlp:Response>
```

What each element does: `Issuer` names the IdP (checked against metadata);
`NameID` is the user id in a chosen `Format` (emailAddress here, but `persistent`
and `transient` are opaque per-SP ids that avoid leaking the email);
`SubjectConfirmationData` binds the assertion to this delivery through `Recipient`
(this SP's ACS), `InResponseTo` (our request) and `NotOnOrAfter`; `Conditions`
set the validity window and `AudienceRestriction` the intended SP; `AuthnStatement`
records when and how the user authenticated; `AttributeStatement` carries claims.
The SP accepted it and read: `{"nameID":"alice@example.org","sessionIndex":"54Dwn...","Role":[...]}`.

### Metadata: how SP and IdP trust each other

Neither side hardcodes the other. Each publishes an XML `EntityDescriptor`. The
IdP's (`/realms/demo/protocol/saml/descriptor`, 3343 bytes) carries `entityID`,
`WantAuthnRequestsSigned`, `SingleSignOnService` endpoints per binding, and a
signing `KeyDescriptor` with the `X509Certificate`. The SP's (`/metadata`) carries
its `entityID`, `AssertionConsumerService` (POST, our ACS URL) and
`WantAssertionsSigned="true"`. Exchanging metadata is the trust setup: the SP
pins the IdP's certificate from the IdP metadata, nowhere else.

### XMLDSig: what signing XML actually means

The signature is not over the base64 blob. `SignedInfo` names a
`CanonicalizationMethod` (exclusive C14N, `xml-exc-c14n#`), a `SignatureMethod`
(`rsa-sha256`), and a `Reference URI="#ID_a6e4..."` pointing by `ID` to the
element it covers, with an enveloped-signature transform (so the `Signature` can
sit inside what it signs) and C14N. C14N matters because a byte-identical XML can
be reserialized (whitespace, namespace order) and must still verify; it fixes the
canonical bytes that are hashed into `DigestValue`. Keycloak here signs the
`Response` and, separately, the `Assertion`. The SP must require the assertion
itself to be signed: a signature only on the `Response` leaves the assertion
swappable if the SP reads an unsigned one.

### The SP's mandatory checks, each failed on purpose (measured)

The library enforces the list from Profiles section 4.1.4.3 and the OWASP cheat
sheet. Each row is a real rejection from the measured SP:

```text
assertion signed, NameID edited to admin@example.org -> rejected: Invalid document signature
response re-posted with a different pinned certificate -> rejected: Invalid document signature
same response posted twice (InResponseTo=always)      -> rejected: InResponseTo is not valid
IdP-initiated response, InResponseTo required          -> rejected: InResponseTo is missing from response
IdP-initiated replay (rejectReplayedAssertions on)     -> rejected: The assertion ID_db06... has already been received
audience set to another SP                             -> rejected: audience mismatch. Expected .../other-sp Received .../sp
Issuer expected as another realm                       -> rejected: Unknown SAML issuer. Expected .../other Received .../demo
assertion past NotOnOrAfter                            -> rejected: SAML assertion expired: clocks skewed too much
```

One trap is measured: with `Destination`/`Recipient` pointed at a different ACS,
node-saml 5.2 only **warns** (`The Response has the Destination ... where
callbackUrl ... was expected. The next major version rejects it`) and still
accepts. Book versus today: many SAML stacks have historically under-checked
`Destination` and `Recipient`; the fix is to reject, not warn, binding the
assertion to this exact endpoint so it cannot be relayed to another SP.

### XML Signature Wrapping against a toy verifier (measured)

XSW is the signature-bypass class: the signature is valid for element X, but the
SP reads element Y. The toy verifier verifies the assertion's XMLDSig with
`xml-crypto`, then reads the first `<NameID>` in the document, a common mistake:

```js
const valid = sx.checkSignature(xml);                 // signature valid: true
console.log('naive NameID:', doc.getElementsByTagNameNS(SAML,'NameID')[0].textContent);
const signed = parse(sx.getSignedReferences()[0]);    // only what the Reference covered
console.log('fixed NameID:', signed.getElementsByTagNameNS(SAML,'NameID')[0].textContent);
```

Attack input: the genuine signed assertion is left byte-for-byte intact, and an
unsigned copy with `admin@example.org` and a different `ID` is inserted before
it. The signature still verifies against the untouched original. Output:

```text
signature valid: true | Reference URI: #ID_76a28471-...
naive NameID: admin@example.org     <- reads the attacker's injected element
fixed NameID:  alice@example.org     <- reads only the bytes the signature covered
```

The fix is one rule: after verifying, operate **only** on the element the
validated `Reference` returned (`getSignedReferences()`), never on an element
found by a fresh document search. Posted to the real node-saml SP, the same
wrapped file is rejected (`Invalid document signature`): it canonicalizes and
reads the signed node, not the first match. Crafting a wrapping that defeats a
hardened, maintained library is docs only here: it is the documented XSW family
(OWASP XML Security Cheat Sheet, and Somorovsky et al., "On Breaking SAML"),
defeated by validating position, not just the cryptography.

### Attributes to roles, and Single Logout (measured)

Attributes map to app roles. Keycloak's role mapper has a `single` toggle: off,
it emits repeated `<saml:Attribute Name="Role">` each with one value and the
library kept only one; on, it emits one `Attribute` with many `AttributeValue`
and the SP read the full array `["finance-approver",...]`. Read multi-valued
attributes deliberately; do not trust that one call returns them all. **Single
Logout** (SLO) propagates a logout: the SP sends a signed `LogoutRequest` naming
the `NameID` and `SessionIndex`, decoded here as:

```xml
<samlp:LogoutRequest ID="_409e..." Destination="http://localhost:6360/realms/demo/protocol/saml">
  <saml:Issuer>http://localhost:6361/sp</saml:Issuer>
  <saml:NameID Format="...emailAddress">alice@example.org</saml:NameID>
  <samlp2:SessionIndex>abc</samlp2:SessionIndex>
</samlp:LogoutRequest>
```

SLO is fragile in practice: front-channel logout depends on the browser reaching
every SP, one unreachable SP breaks the chain, and it does not revoke anything an
SP already issued. Many deployments disable it and rely on short sessions.

### SAML versus OIDC, and where this track goes next

SAML persists because enterprise IdPs, SaaS catalogs and federations (InCommon,
eduGAIN) standardized on it, and migrations are slow. OIDC (I10, this track)
replaced it for new apps: JSON and JWT instead of XML and XMLDSig, so no C14N and
no XSW class, native mobile and SPA support, and a simpler discovery. Reach for
SAML only when the other side speaks only SAML. Protocol choice overall is I14,
and Kerberos (I8) is the on-premises Windows SSO this sits beside.

## Trade-offs

- **IdP-initiated versus SP-initiated.** IdP-initiated is convenient (portal
  tile) but has no `InResponseTo`, so replay protection must come from short
  windows and one-time assertion IDs; SP-initiated binds every response to a
  request. Prefer SP-initiated.
- **Sign the Response or the Assertion.** Signing only the Response is cheaper
  but lets an unsigned assertion be swapped in; require the assertion signed, and
  read only the signed node. Signing both (measured) is safest.
- **XML and XMLDSig versus JWT.** XML canonicalization buys detached, per-element
  signatures but brings the wrapping and XXE attack surface; JWT (OIDC) is a flat
  signed string, simpler and smaller, at the cost of SAML's fine-grained signing.
- **Single Logout versus short sessions.** SLO ends sessions everywhere in theory
  but is brittle (one unreachable SP breaks it); short session lifetimes are less
  thorough but reliable.

## Documentation Links

- [SAML Core 2.0 OS, OASIS](https://docs.oasis-open.org/security/saml/v2.0/saml-core-2.0-os.pdf) (doc)
- [SAML Bindings 2.0 OS, OASIS](https://docs.oasis-open.org/security/saml/v2.0/saml-bindings-2.0-os.pdf) (doc)
- [SAML Profiles 2.0 OS, OASIS](https://docs.oasis-open.org/security/saml/v2.0/saml-profiles-2.0-os.pdf) (doc)
- [SAML Metadata 2.0 OS, OASIS](https://docs.oasis-open.org/security/saml/v2.0/saml-metadata-2.0-os.pdf) (doc)
- [XML Signature Syntax and Processing 1.1, W3C](https://www.w3.org/TR/xmldsig-core1/) (doc)
- [SAML Security Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/SAML_Security_Cheat_Sheet.html) (doc)
- [XML Security Cheat Sheet, OWASP](https://cheatsheetseries.owasp.org/cheatsheets/XML_Security_Cheat_Sheet.html) (doc)
- [Server Administration Guide, Keycloak](https://www.keycloak.org/docs/latest/server_admin/index.html) (doc)
- [Securing applications with SAML, Keycloak](https://www.keycloak.org/securing-apps/saml-galleon-layers) (doc)
