---
version: 1.0
updatedAt: 2026-09-26
title: "Let's Encrypt com cert-manager: HTTP-01 vs DNS-01"
summary: "Issuers ACME, os requisitos de cada desafio, wildcards e clusters privados, depuração de desafios pendentes, e validades de certificado cada vez mais curtas."
---
## Objective

O Let's Encrypt emite certificados publicamente confiáveis de graça, pelo protocolo ACME, depois que você prova que controla o domínio. O cert-manager automatiza essa prova com um de dois tipos de desafio: **HTTP-01** (servir um token em `http://<domínio>/.well-known/acme-challenge/...`) ou **DNS-01** (publicar um token num registro `TXT`). Eles têm requisitos diferentes, e escolher o errado é o principal motivo de certificados ficarem em `READY False`. Este conceito cobre um ClusterIssuer ACME, os dois desafios, staging vs produção, rate limits, e as validades mais curtas que o Let's Encrypt está adotando.

## Use Cases

- HTTPS público para uma API e uma página de login num nó com IP público.
- Certificados para um cluster que **não** é acessível pela internet (rede do escritório, só VPN).
- Certificados wildcard (`*.example.com`).
- Entender um desafio preso em `pending`.

## Deep Dive

### Um ClusterIssuer ACME

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata: {name: letsencrypt-staging}
spec:
  acme:
    server: https://acme-staging-v02.api.letsencrypt.org/directory
    email: platform-team@example.com
    privateKeySecretRef: {name: letsencrypt-staging-account}
    solvers:
      - http01:
          ingress: {ingressClassName: public}
```

Comece pelo **staging**. Os certificados dele não são confiáveis nos navegadores, mas os rate limits são generosos, então um erro de configuração não bloqueia você. Troque o `server` para `https://acme-v02.api.letsencrypt.org/directory` (e use um nome de issuer e uma Secret de conta separados) quando os certificados de staging estiverem sendo emitidos com sucesso.

Depois anote um Ingress exatamente como com qualquer issuer: `cert-manager.io/cluster-issuer: letsencrypt-prod`.

### HTTP-01

O cert-manager cria um Ingress (ou HTTPRoute) temporário e um Pod solver que serve o token. Os servidores de validação do Let's Encrypt, **a partir da internet pública**, buscam:

```
http://api.example.com/.well-known/acme-challenge/<token>
```

Requisitos:

- DNS público `A`/`AAAA` do hostname apontando para o nó ou o seu load balancer.
- **Porta 80** acessível pela internet (a validação sempre começa na porta 80; redirects para a 443 são seguidos).
- O Ingress do solver precisa ser servido pelo controller indicado em `ingressClassName`.

Limites: sem wildcards, uma validação por hostname, e simplesmente não funciona para um cluster que a internet não alcança. Se um firewall só libera a 443, o HTTP-01 falha.

### DNS-01

O cert-manager cria um registro `TXT` `_acme-challenge.example.com` pela API do seu provedor de DNS, o Let's Encrypt consulta o DNS público, e o cert-manager remove o registro depois.

```yaml
solvers:
  - dns01:
      cloudflare:
        apiTokenSecretRef:
          name: cloudflare-api-token      # no namespace do cert-manager, para um ClusterIssuer
          key: api-token
    selector:
      dnsZones: [example.com]
```

O cert-manager suporta Cloudflare, Route 53, Google Cloud DNS, Azure DNS, DigitalOcean, RFC 2136 (BIND e companhia) e outros via webhooks.

Vantagens:

- **Funciona para clusters sem nenhum acesso de entrada pela internet**, porque só o DNS está envolvido. É a resposta usual para serviços internos que ainda querem certificados publicamente confiáveis (o hostname precisa existir numa zona pública, mas pode resolver para um IP privado).
- **Wildcards** (`*.example.com`) só são possíveis com DNS-01.

Custos:

- Um token de API com permissão para editar o DNS fica dentro do cluster. Restrinja-o à zona em questão e, onde o provedor permitir, a registros `TXT`.
- Atraso de propagação: o cert-manager verifica se o registro está visível antes de pedir a validação. DNS split-horizon (um servidor interno respondendo pela mesma zona) pode fazer essa verificação falhar; aponte as verificações do cert-manager para resolvers públicos com `--dns01-recursive-nameservers=1.1.1.1:53,8.8.8.8:53` e `--dns01-recursive-nameservers-only`.

### Escolhendo

| Situação | Desafio |
|---|---|
| Nó público, porta 80 aberta, hostnames individuais | HTTP-01 |
| Cluster interno ou só por VPN | DNS-01 |
| Certificado wildcard | DNS-01 |
| Provedor de DNS sem API | HTTP-01, ou uma delegação CNAME do `_acme-challenge` para uma zona que você consegue automatizar |

Um issuer pode ter vários solvers com selectors (por exemplo HTTP-01 por padrão e DNS-01 para `dnsZones: [internal.example.com]`).

### Depurando um certificado pendente

A cadeia de objetos é `Certificate -> CertificateRequest -> Order -> Challenge`. O Challenge tem a mensagem útil:

```bash
kubectl get certificate,certificaterequest,order,challenge -A
kubectl describe challenge <nome>
```

Motivos típicos: `connection refused` ou timeout na porta 80 (HTTP-01 inacessível), `404` (o Ingress do solver não é servido pelo controller, classe errada), `DNS record not yet propagated` (verificação do DNS-01), `rateLimited` (veja abaixo).

### Rate limits e validades

O Let's Encrypt de produção limita certificados por domínio registrado por semana e certificados duplicados, entre outros. Depurar contra a produção é o jeito mais rápido de bater nesses limites; é para isso que existe o staging.

As validades estão ficando mais curtas, o que torna a automação obrigatória em vez de conveniente:

- Desde 13 de maio de 2026, o perfil ACME opcional `tlsserver` emite certificados de **45 dias**.
- A partir de 10 de fevereiro de 2027 o perfil padrão `classic` passa a 64 dias, e a partir de 16 de fevereiro de 2028 a 45 dias.

O cert-manager renova aos dois terços da validade por padrão, então se adapta sozinho; o que não pode existir é qualquer passo manual ou monitoramento que assuma 90 dias.

## Trade-offs

- **HTTP-01 vs DNS-01.** O HTTP-01 não precisa de credencial no cluster, mas exige porta 80 de entrada e acesso público. O DNS-01 funciona em qualquer lugar e suporta wildcards, mas guarda no cluster uma credencial capaz de editar o DNS.
- **Wildcard vs certificados por host.** Um wildcard simplifica a configuração; a chave dele é compartilhada por todo serviço que o usa, então um vazamento afeta todos.
- **Certificados públicos vs uma CA privada.** Certificados públicos não precisam de distribuição de confiança; uma CA privada funciona sem nenhuma dependência externa ou rate limit.

## Documentation Links

- [cert-manager docs: ACME](https://cert-manager.io/docs/configuration/acme/): configuração do issuer, solvers, selectors.
- [cert-manager docs: HTTP01](https://cert-manager.io/docs/configuration/acme/http01/): solvers de ingress e de Gateway API.
- [cert-manager docs: DNS01](https://cert-manager.io/docs/configuration/acme/dns01/): provedores, nameservers recursivos.
- [Let's Encrypt: Challenge Types](https://letsencrypt.org/docs/challenge-types/): HTTP-01, DNS-01 e TLS-ALPN-01 comparados.
- [Let's Encrypt: Rate Limits](https://letsencrypt.org/docs/rate-limits/): limites de produção e staging.
- [Let's Encrypt: Decreasing Certificate Lifetimes to 45 Days](https://letsencrypt.org/2025/12/02/from-90-to-45): cronograma de validades mais curtas.
