---
version: 1.0
updatedAt: 2026-09-26
title: "DNS de Services e Acesso entre Namespaces"
summary: "Nomes de Service dentro e entre namespaces, a lista de search e o ndots, como depurar a resolução, e por que políticas de egress podem quebrar o DNS."
---
## Objective

Todo Service ganha um nome DNS, servido pelo CoreDNS dentro do cluster: `<service>.<namespace>.svc.cluster.local`. Os Pods usam esse nome para se alcançarem sem conhecer nenhum IP. Nomes curtos só funcionam dentro do mesmo namespace, o que é a origem do bug clássico "resolve daqui mas não dali" quando uma aplicação em `team-a` fala com um banco em `shared`. Este conceito cobre os formatos de nome, como a lista de search do `resolv.conf` do Pod faz os nomes curtos funcionarem, por que o `ndots:5` importa para buscas externas, e como depurar a resolução.

## Use Cases

- Apontar uma aplicação para um banco ou cache num namespace `shared`.
- Usar os mesmos manifests em vários namespaces sem fixar IPs.
- Entender buscas DNS externas lentas a partir de Pods.
- Depurar erros de "unknown host" ou "could not resolve host" num container.

## Deep Dive

### Os nomes que um Service recebe

Para um Service `db` no namespace `shared`:

| Nome | Resolve a partir de |
|---|---|
| `db` | só Pods em `shared` |
| `db.shared` | qualquer namespace |
| `db.shared.svc` | qualquer namespace |
| `db.shared.svc.cluster.local` | qualquer namespace (totalmente qualificado) |

Um Service `ClusterIP` resolve para o seu IP virtual. Um Service headless (`clusterIP: None`) resolve direto para os IPs dos seus Pods prontos, e Pods de um StatefulSet por trás dele também ganham nomes individuais (`db-0.db.shared.svc.cluster.local`). Portas nomeadas ganham registros SRV (`_http._tcp.api.team-a.svc.cluster.local`).

Os próprios Pods não ganham nomes DNS úteis por padrão; endereçe sempre Services.

### Por que nomes curtos só funcionam no mesmo namespace

Todo Pod recebe um `/etc/resolv.conf` gerado pelo kubelet. Verificado a partir de um Pod no namespace `app` no k3s:

```
search app.svc.cluster.local svc.cluster.local cluster.local
nameserver 10.43.0.10
options ndots:5
```

(No MicroK8s o nameserver é `10.152.183.10`.)

O resolver tenta cada sufixo de search em ordem. `db` vira primeiro `db.app.svc.cluster.local`: só encontra se o Service mora em `app`. `db.shared` vira `db.shared.app.svc.cluster.local` (erro), depois `db.shared.svc.cluster.local` (acerto). Verificado: a partir do namespace `app`, `nslookup db` falhou com `NXDOMAIN`, enquanto `wget http://db.infra` e `http://db.infra.svc.cluster.local` alcançaram o Service em `infra`.

Regra prática para configuração: **mesmo namespace, nome curto; outro namespace, pelo menos `service.namespace`**. Muitos times usam sempre a forma totalmente qualificada na configuração por legibilidade; com um ponto final (`db.shared.svc.cluster.local.`) ela também pula a lista de search por completo.

### ndots:5 e nomes externos

`ndots:5` significa "um nome com menos de 5 pontos é tentado primeiro com cada sufixo de search". `api.github.com` tem 2 pontos, então o resolver pergunta por `api.github.com.app.svc.cluster.local`, `api.github.com.svc.cluster.local` e `api.github.com.cluster.local` (todos NXDOMAIN, normalmente para A e AAAA) antes do nome real. Funciona, só custa consultas extras em toda busca sem cache. Para clientes que falam muito, dá para reduzir por Pod:

```yaml
spec:
  dnsConfig:
    options:
      - {name: ndots, value: "2"}
```

Muitos runtimes e bibliotecas de cliente também guardam resultados de DNS em cache por um tempo, o que esconde boa parte desse custo e também significa que um registro alterado é percebido com atraso.

### Depurando a resolução

```bash
# um Pod descartável no namespace da aplicação com problema
kubectl -n team-a run dnstest --rm -it --image=busybox:1.37 --restart=Never -- sh
/ # cat /etc/resolv.conf
/ # nslookup db.shared
/ # nslookup kubernetes.default
/ # wget -qO- -T 3 http://api.team-a:80/healthz
```

Lendo os resultados:

- `nslookup kubernetes.default` falha: o próprio CoreDNS está fora ou inacessível (confira `kubectl -n kube-system get pods -l k8s-app=kube-dns`, e se uma NetworkPolicy de egress bloqueia UDP/TCP 53).
- O nome resolve mas a conexão dá timeout: o DNS está bem; olhe os endpoints do Service (`kubectl get endpointslices -l kubernetes.io/service-name=db -n shared`) e as NetworkPolicies.
- `NXDOMAIN` para um nome que você espera: namespace errado, erro de digitação, ou o Service não existe.

Armadilha verificada: com uma NetworkPolicy default-deny de egress no namespace do cliente, o próprio DNS falha (`nslookup: write to '10.43.0.10': Connection refused`), então todo hostname parece "desconhecido" mesmo que o problema real seja a política de rede. Políticas de egress precisam liberar a porta 53 para o CoreDNS.

### Acesso entre namespaces é uma questão de rede, não de DNS

O DNS torna todo Service do cluster resolvível a partir de qualquer namespace. Se a conexão é permitida depende só das NetworkPolicies. Referências a recursos são diferentes: um Pod só consegue montar ConfigMaps, Secrets e PVCs do seu próprio namespace, então credenciais para um banco compartilhado precisam ser copiadas (ou sincronizadas) para cada namespace consumidor.

### ExternalName para aliases

Um Service `ExternalName` é um CNAME de DNS, útil para dar um nome local a uma dependência externa ou de outro namespace:

```yaml
apiVersion: v1
kind: Service
metadata: {name: db, namespace: team-a}
spec:
  type: ExternalName
  externalName: db.shared.svc.cluster.local
```

Agora `db` funciona como nome curto dentro de `team-a`. Não há proxy nem mapeamento de porta, é só DNS, e clientes TLS continuam vendo o hostname do destino na verificação do certificado.

## Trade-offs

- **Nomes curtos vs totalmente qualificados na configuração.** Nomes curtos mantêm os manifests portáveis entre namespaces para dependências do mesmo namespace; nomes totalmente qualificados são explícitos e imunes a surpresas da lista de search.
- **`ndots` menor vs padrão.** Menos consultas desperdiçadas para nomes externos, com o risco de quebrar buscas curtas de nomes com várias partes como `db.shared` (1 ponto ainda é menos que 2, tudo bem; mas revise antes de reduzir mais).
- **Alias ExternalName vs nome direto.** Um alias esconde onde uma dependência mora e facilita movê-la; também esconde onde ela mora quando você está depurando.

## Lab

Neste lab você recebe um banco de dados já rodando no namespace `shared` e um manifesto `team-a.yaml` com dois apps que não conseguem falar com ele: ambos falham com `wget: bad address`, que é como um NXDOMAIN aparece dentro de um container. Seu trabalho é editar só esse manifesto. A ideia central é sentir como o DNS do cluster resolve nomes de Service: o nome curto só vale dentro do próprio namespace, o nome qualificado atravessa namespaces, e para um app que você não pode mudar é preciso criar um alias local sem duplicar o banco.

**O cenário**

Um Service `db` (porta 8080, um servidor HTTP do busybox que responde `db ok`) vive no namespace `shared`. Dois apps em `team-a` precisam dele. Os testes rodam num cluster k3s de verdade, iniciado pelo Testcontainers.

- `src/test/resources/k8s/shared.yaml`: o banco em `shared` (Deployment e Service `db`). É dado, você não mexe.
- `src/main/resources/k8s/team-a.yaml`: o namespace `team-a` e dois Deployments. É o seu arquivo.
- `api`: lê a URL do banco na variável `DB_URL` e só fica pronto (readinessProbe) enquanto o banco responde.
- `legacy`: tem a URL `http://database:8080` fixa na imagem e você não pode alterá-la.
- `src/test/java/ServiceDnsTest.java`: faz as requisições de dentro dos Pods e confere o resultado.

**O que você vai fazer, passo a passo**

1. **Rode os testes e leia a falha.** Os dois apps devolvem `wget: bad address`. Isso diz que o problema é resolução de nome, não rede nem porta.
2. **Corrigir o `DB_URL` do `api` (TODO-00).** O valor atual é `http://db:8080`, que o DNS procura em `team-a`. Use o nome do Service qualificado com o namespace, para que o resolver chegue ao `db` de `shared`.
3. **Dar o nome `database` ao `legacy` (TODO-01).** Você não pode mudar o app, então crie em `team-a` um Service que faça o nome `database` resolver para o mesmo banco, sem rodar uma segunda cópia e sem escrever um IP no manifesto. Os testes rejeitam um segundo banco e também um Service com ClusterIP próprio, então pense em que tipo de Service apenas devolve um nome em vez de um endereço.

**Como saber que terminou**

`mvn -pl kubernetes-concepts/service-dns-and-cross-namespace-access test` passa nos três testes: `apiReachesTheDatabase`, `legacyReachesTheDatabase` e `theDatabaseRunsOnlyOnce`. Você deve conseguir explicar por que `db` funciona só dentro do namespace, o que o nome qualificado adiciona e por que o alias não cria um segundo banco.

**Desafios opcionais**

- **TODO-02:** rode `cat /etc/resolv.conf` no Pod `api`. Quais search domains fazem `db.shared` funcionar, e quantas consultas DNS o `ndots:5` provoca para um nome como `example.com` antes da consulta certa?

**Pré-requisitos:** Docker rodando (os testes sobem um container `rancher/k3s` e baixam `busybox` dentro dele), Java e Maven, e o artigo Service DNS and Cross-Namespace Access.

**Como rodar:** clone o repositório e, a partir da raiz, rode `mvn -pl kubernetes-concepts/service-dns-and-cross-namespace-access test`. Os comentários `TODO-00` e `TODO-01` em `team-a.yaml` marcam o que falta, e as falhas dos testes mostram o que ainda não responde.

## Documentation Links

- [Kubernetes docs: DNS for Services and Pods](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/): formatos de registro, `dnsPolicy`, `dnsConfig`.
- [Kubernetes docs: Debugging DNS Resolution](https://kubernetes.io/docs/tasks/administer-cluster/dns-debugging-resolution/): verificações passo a passo.
- [Kubernetes docs: Service (ExternalName)](https://kubernetes.io/docs/concepts/services-networking/service/#externalname): comportamento de CNAME e ressalvas.
