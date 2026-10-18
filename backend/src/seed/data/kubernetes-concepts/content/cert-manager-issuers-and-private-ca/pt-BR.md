---
version: 1.0
updatedAt: 2026-09-26
title: "cert-manager: Issuers e uma CA Privada"
summary: "Issuer vs ClusterIssuer, criar uma CA raiz privada dentro do cluster, emitir certificados de Ingress a partir dela, e fazer os clientes confiarem nela."
---
## Objective

O cert-manager transforma certificados TLS em objetos do Kubernetes: você declara um `Certificate` (ou anota um Ingress), e o cert-manager o obtém de um **Issuer**, guarda numa Secret `kubernetes.io/tls` e renova antes de expirar. Issuers podem ser ACME (Let's Encrypt), HashiCorp Vault, uma CA de nuvem, ou uma **CA sua**. Para hostnames internos que nenhuma CA pública vai certificar (`*.internal`, `*.corp.example.com`, um laboratório), um issuer de CA privada dá certificados reais, renovados automaticamente, em que as suas próprias máquinas confiam. Este conceito cobre a instalação do cert-manager, Issuer vs ClusterIssuer, a criação de uma CA raiz privada dentro do cluster, e a emissão de certificados para Ingresses a partir dela.

## Use Cases

- HTTPS para interfaces de administração internas (dashboards, Grafana, ferramentas internas) em hostnames sem DNS público.
- Substituir o certificado autoassinado padrão do controller por certificados em que navegadores e runtimes de aplicação podem passar a confiar.
- Emitir certificados para TLS entre serviços (bancos de dados, filas de mensagens) a partir da mesma CA.
- Usar a CA intermediária já existente da empresa para assinar certificados do cluster.

## Deep Dive

### Instalando

```bash
microk8s enable cert-manager
kubectl -n cert-manager get pods      # cert-manager, cainjector, webhook
```

O add-on do MicroK8s 1.35 instala o cert-manager v1.19. Em outros ambientes, o Helm chart oficial ou o manifest estático da página de releases do cert-manager fazem o mesmo. Espere o webhook antes de criar recursos, senão o API server os rejeita:

```bash
kubectl -n cert-manager rollout status deploy/cert-manager-webhook
```

### Issuer vs ClusterIssuer

- `Issuer` é de namespace: só emite Certificates no seu próprio namespace, e toda Secret que ele referencia (uma chave de CA, a chave da conta ACME) fica nesse namespace.
- `ClusterIssuer` é de escopo de cluster: pode ser usado de qualquer namespace; as suas Secrets ficam no namespace do cert-manager (o "cluster resource namespace", `cert-manager` por padrão).

Para uma única CA de plataforma usada por todos os namespaces, um ClusterIssuer é a escolha natural.

### Criando uma CA raiz privada no cluster

Três objetos: um issuer autoassinado usado uma vez, um certificado de CA emitido por ele, e um issuer de CA que assina com essa CA.

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata: {name: selfsigned-bootstrap}
spec:
  selfSigned: {}
---
apiVersion: cert-manager.io/v1
kind: Certificate
metadata: {name: internal-root-ca, namespace: cert-manager}
spec:
  isCA: true
  commonName: Internal Root CA
  secretName: internal-root-ca
  duration: 87600h                 # 10 anos
  privateKey: {algorithm: ECDSA, size: 256}
  issuerRef: {name: selfsigned-bootstrap, kind: ClusterIssuer}
---
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata: {name: internal-ca}
spec:
  ca:
    secretName: internal-root-ca   # lida do namespace do cert-manager
```

Verificado no MicroK8s: os dois issuers ficaram `READY True` em segundos. Aplicar o `Certificate` imprimiu um aviso que vale conhecer:

```
Warning: spec.privateKey.rotationPolicy: In cert-manager >= v1.18.0, the default value changed from `Never` to `Always`.
```

Com `Always`, toda renovação gera uma chave privada nova. Para a CA raiz, isso significa que uma renovação produz uma **CA nova** em que os clientes ainda não confiam. Defina `rotationPolicy: Never` no certificado da CA, ou dê a ele uma duração tão longa que você vai planejar a rotação de forma deliberada.

### Usando a CA da empresa no lugar

Se já existe uma PKI interna, coloque o certificado e a chave da intermediária numa Secret `kubernetes.io/tls` no namespace do cert-manager e aponte o ClusterIssuer de CA para ela. Clientes que já confiam na raiz da empresa passam a confiar automaticamente em todo certificado do cluster, sem nenhuma raiz nova para distribuir.

```bash
kubectl -n cert-manager create secret tls corp-intermediate \
  --cert=intermediate-chain.pem --key=intermediate.key
```

### Certificados para Ingresses

O caminho mais simples é o ingress-shim: anote o Ingress e o cert-manager cria o `Certificate` para cada entrada `tls`.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-tls
  annotations:
    cert-manager.io/cluster-issuer: internal-ca
spec:
  ingressClassName: public
  tls:
    - hosts: [secure.example.test]
      secretName: secure-example-tls
  rules:
    - host: secure.example.test
      http:
        paths:
          - {path: /, pathType: Prefix, backend: {service: {name: echo, port: {number: 80}}}}
```

Verificado: o cert-manager criou `Certificate/secure-example-tls` (`READY True`), a Secret tem tipo `kubernetes.io/tls` com `tls.crt`, `tls.key` e `ca.crt`, e o Traefik a serviu:

```
$ curl -vk --resolve secure.example.test:443:<node-ip> https://secure.example.test/
*  expire date: Dec 25 20:19:24 2026 GMT
*  issuer: CN=Internal Root CA
```

A validade padrão é de 90 dias, com renovação aos dois terços. Ajuste com as annotations `cert-manager.io/duration` e `cert-manager.io/renew-before`, ou escreva o `Certificate` você mesmo para ter controle total (algoritmo da chave, SANs extras, usages).

### Fazendo os clientes confiarem na CA

Uma CA privada só ajuda se os clientes confiarem nela:

```bash
kubectl -n cert-manager get secret internal-root-ca -o jsonpath='{.data.ca\.crt}' | base64 -d > internal-root-ca.crt
```

- Navegadores e SO: importar no trust store do sistema (MDM da empresa para laptops).
- Nós MicroK8s baixando de um registry com esse certificado: `ca =` em `certs.d/<host:porta>/hosts.toml`.
- Aplicações chamando endpoints HTTPS internos: adicionar a CA ao trust store do runtime (o bundle do SO na imagem, uma truststore Java, `NODE_EXTRA_CA_CERTS` no Node.js), normalmente montado a partir de uma ConfigMap.
- Distribuição dentro do cluster para muitos namespaces: o `trust-manager` do cert-manager sincroniza um bundle de CA numa ConfigMap em cada namespace.

### Depurando a emissão

```bash
kubectl get certificate,certificaterequest -A
kubectl describe certificate secure-example-tls
kubectl -n cert-manager logs deploy/cert-manager
```

Um `Certificate` preso em `READY False` mostra o motivo nos seus eventos e no `CertificateRequest` relacionado (issuer não pronto, Secret da CA no namespace errado, hostnames inválidos).

## Trade-offs

- **CA privada vs CA pública.** Uma CA privada funciona para qualquer hostname, offline, sem rate limits, e exige distribuir a sua raiz para todo cliente. Certificados públicos são confiáveis em todo lugar e precisam de DNS público e de um desafio ACME funcionando.
- **Raiz dentro do cluster vs intermediária corporativa.** Uma raiz no cluster é rápida de montar e vira mais uma raiz para distribuir e proteger (a chave dela fica numa Secret). Uma intermediária corporativa se encaixa na confiança e na governança existentes, ao custo de envolver os donos da PKI.
- **Validade curta vs longa.** Validades curtas limitam o estrago de uma chave vazada e saem de graça com renovação automática; também tornam qualquer falha de renovação visível mais cedo. Monitore `certmanager_certificate_expiration_timestamp_seconds`.

## Lab

Neste lab você recebe um `tls.yaml` com um issuer, um Certificate e um Ingress que, juntos, deveriam dar HTTPS ao `shop.lab` com um certificado da CA privada da empresa, mas que não funcionam. Seu trabalho é achar e corrigir três defeitos independentes, editando só esse arquivo. A ideia central é sentir que, com o cert-manager, quase todo problema de emissão está escrito no `status` dos objetos (issuer, Certificate), e que três peças precisam concordar: onde o issuer lê a CA, quais nomes o certificado cobre e qual Secret o Ingress entrega ao Traefik.

**O cenário**

A CA privada está no Secret `lab-ca` no namespace `web`, e um cliente que confia só nessa CA precisa abrir `https://shop.lab`. Os testes instalam o cert-manager num k3s de verdade (com o Traefik que vem nele, iniciado pelo Testcontainers) e validam o TLS com `curl --cacert`.

- `src/test/resources/k8s/apps.yaml`: o app `shop` em `web`, o Secret `lab-ca` (a CA) e um Pod `client` cujo `curl` confia apenas nessa CA. Dado.
- `src/main/resources/k8s/tls.yaml`: um `ClusterIssuer` `lab-ca`, um `Certificate` `shop` (Secret de saída `shop-tls`) e o `Ingress` `shop` com a seção `tls`. É o seu arquivo.
- `src/test/java/CertManagerTest.java`: aplica o seu manifesto e confere o certificado e a conexão HTTPS.

O Secret da CA fica onde está: você corrige o manifesto, não move a CA.

**O que você vai fazer, passo a passo**

1. **Rode os testes e leia as conditions.** As mensagens de falha mostram as conditions dos issuers e do Certificate, e o subject e o issuer do certificado que o Traefik realmente serviu.
2. **Deixar o issuer Ready (TODO-00).** Hoje ele nunca fica pronto. Leia o status e pense onde um `ClusterIssuer` procura o Secret da CA comparado com onde ele está de fato, então escolha o tipo de issuer que lê o Secret no namespace `web`.
3. **Fazer o Traefik servir o certificado emitido (TODO-01).** Mesmo com o certificado emitido, o Traefik responde com o seu certificado padrão. Compare o `secretName` do Certificate com o do Ingress.
4. **Cobrir o nome certo (TODO-02).** O Traefik escolhe o certificado comparando o host pedido com os nomes dentro de cada um, e usa o padrão quando nenhum casa. Veja os `dnsNames` do Certificate e ajuste para o host que o cliente acessa.

**Como saber que terminou**

`mvn -pl kubernetes-concepts/cert-manager-issuers-and-private-ca test` passa em `certificateIsIssued` e `httpsIsTrustedWithThePrivateCa`. Você deve conseguir explicar que condition de cada objeto revelava cada defeito e por que o Traefik cai no certificado padrão em silêncio quando o Secret ou o nome não bate.

**Desafios opcionais**

- **TODO-03:** em vez de um objeto Certificate, adicione a annotation `cert-manager.io/issuer: lab-ca` ao Ingress e apague o Certificate. O que o cert-manager cria, e a partir de quais campos do Ingress?

**Pré-requisitos:** Docker rodando (os testes sobem um container `rancher/k3s`, que baixa o cert-manager v1.21.2 e as imagens `busybox` e `curl`), Java e Maven, e o artigo cert-manager: Issuers and a Private CA.

**Como rodar:** clone o repositório e, a partir da raiz, rode `mvn -pl kubernetes-concepts/cert-manager-issuers-and-private-ca test`. Os comentários `TODO-00`, `TODO-01` e `TODO-02` em `tls.yaml` marcam cada defeito. A primeira execução demora, porque o cert-manager é baixado e instalado.

## Documentation Links

- [cert-manager docs: Installation](https://cert-manager.io/docs/installation/): Helm e manifests estáticos.
- [cert-manager docs: CA issuer](https://cert-manager.io/docs/configuration/ca/): configurando um ClusterIssuer de CA.
- [cert-manager docs: SelfSigned (bootstrapping a CA)](https://cert-manager.io/docs/configuration/selfsigned/#bootstrapping-ca-issuers): o padrão de três objetos.
- [cert-manager docs: Securing Ingress resources](https://cert-manager.io/docs/usage/ingress/): annotations do ingress-shim.
- [cert-manager docs: Certificate resource (rotationPolicy)](https://cert-manager.io/docs/usage/certificate/#configuring-private-key-rotation): padrões de rotação da chave privada.
- [cert-manager docs: trust-manager](https://cert-manager.io/docs/trust/trust-manager/): distribuindo bundles de CA.
