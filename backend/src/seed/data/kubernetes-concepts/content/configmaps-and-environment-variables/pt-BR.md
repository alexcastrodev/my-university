---
version: 1.0
updatedAt: 2026-09-26
title: "ConfigMaps e Variáveis de Ambiente"
summary: "envFrom e valueFrom, precedência e nomes de chave, chaves faltando e CreateContainerConfigError, por que mudanças não chegam a Pods em execução, e variáveis de service links."
---
## Objective

Uma ConfigMap guarda configuração não sensível como pares chave/valor, para que a mesma imagem rode em qualquer ambiente com configurações diferentes. Os containers a consomem de dois jeitos: como **variáveis de ambiente** (uma chave com `configMapKeyRef`, ou todas com `envFrom`) ou como **arquivos** num volume. Secrets usam a mesma mecânica (`secretKeyRef`, `secretRef`). Este conceito cobre o caminho das variáveis de ambiente: regras de precedência, o que acontece com chaves faltando e nomes estranhos, por que uma ConfigMap alterada não chega a um container em execução, e os tipos de ConfigMap/Secret que você vai encontrar.

## Use Cases

- Definir o modo da aplicação, níveis de log e feature flags por ambiente.
- Injetar uma senha de banco de uma Secret como `DB_PASSWORD` ao lado de configurações não secretas de uma ConfigMap.
- Reaproveitar uma ConfigMap entre a API, consumidores e jobs que compartilham uma imagem.
- Depurar um Pod preso em `CreateContainerConfigError`.

## Deep Dive

### Criando ConfigMaps

```bash
kubectl -n team-a create configmap app-config \
  --from-literal=APP_MODE=production \
  --from-literal=LOG_LEVEL=INFO \
  --from-env-file=app.env \
  --dry-run=client -o yaml | kubectl apply -f -
```

```yaml
apiVersion: v1
kind: ConfigMap
metadata: {name: app-config, namespace: team-a}
data:
  APP_MODE: production
  LOG_LEVEL: INFO
  application.yaml: |          # um arquivo inteiro como uma chave, normalmente montado como volume
    server:
      port: 8080
```

Os valores são sempre strings. `true` ou `8080` precisam de aspas no YAML (`"true"`), senão a API rejeita o objeto. O limite total de tamanho é 1 MiB.

### envFrom: toda chave vira uma variável

```yaml
containers:
  - name: app
    image: registry.example.com/demo/web-app:1.4.2
    envFrom:
      - configMapRef: {name: app-config}
      - secretRef: {name: db-credentials}
      - configMapRef: {name: tenant-settings}
        prefix: TENANT_                 # TENANT_<chave>
    env:
      - name: LOG_LEVEL                  # env explícito vence o envFrom
        value: WARN
      - name: DB_PASSWORD
        valueFrom:
          secretKeyRef: {name: db-credentials, key: password}
      - name: POD_NAME
        valueFrom:
          fieldRef: {fieldPath: metadata.name}
```

Precedência, verificada: uma chave `LOG_LEVEL=INFO` na ConfigMap e `env: LOG_LEVEL=WARN` no Pod produzem `LOG_LEVEL=WARN`. O `env` explícito sempre sobrescreve o `envFrom`. Entre várias fontes `envFrom` com a mesma chave, a **última** da lista vence, em silêncio.

### Nomes de chave

Chaves que não são identificadores válidos de shell eram ignoradas pelo `envFrom` com um evento `InvalidEnvironmentVariableNames`. O Kubernetes atual relaxou essa regra (qualquer ASCII imprimível exceto `=`). Verificado na v1.36: as chaves `app.name`, `log-level` e `1BAD` chegaram todas ao ambiente sem alteração.

Isso é válido para o kernel, mas não para todo consumidor: um shell não consegue referenciar `$log-level`, e muitas bibliotecas de configuração que mapeiam `LOG_LEVEL` para uma configuração não reconhecem `log-level`. Mantenha as chaves de ConfigMap destinadas a `envFrom` em `UPPER_SNAKE_CASE`.

### ConfigMaps e chaves faltando

Uma referência a uma chave que não existe impede o container de subir:

```
$ kubectl get pod envmissing
NAME         READY   STATUS                       RESTARTS   AGE
envmissing   0/1     CreateContainerConfigError   0          12s

message: couldn't find key nope in ConfigMap lab/appcfg
```

O mesmo acontece quando a ConfigMap ou a Secret inteira não existe, o que é comum quando a aplicação é aplicada antes da sua configuração. O Pod se recupera sozinho assim que o objeto existe (o kubelet tenta de novo). Se o valor é de fato opcional, diga isso:

```yaml
envFrom:
  - configMapRef: {name: tenant-overrides, optional: true}
```

### Mudanças não chegam a containers em execução

Variáveis de ambiente são lidas uma vez, quando o container sobe. Atualizar a ConfigMap não muda nada nos Pods em execução, e um `kubectl apply` no Deployment também não os reinicia, porque o template do Pod não mudou. Duas formas de propagar:

```bash
kubectl -n team-a rollout restart deployment/api       # manual, depois de mudar a ConfigMap
```

ou fazer a mudança entrar no template do Pod automaticamente: o `configMapGenerator` do Kustomize adiciona um hash do conteúdo ao nome da ConfigMap (`app-config-g5t6m8m4hk`) e reescreve todas as referências, então conteúdo novo significa nome novo, template alterado e um rolling update. Veja o conceito de generators do Kustomize.

Arquivos de ConfigMap montados, ao contrário, são atualizados no lugar depois de cerca de um minuto, mas só se a aplicação os reler.

### Variáveis que você não definiu: service links

O Kubernetes também injeta variáveis no estilo dos links do Docker para cada Service do namespace do Pod que existia quando o Pod subiu. Verificado no k3s v1.36 com um Service chamado `redis` no namespace:

```
REDIS_PORT=tcp://10.43.51.106:6379
REDIS_PORT_6379_TCP=tcp://10.43.51.106:6379
REDIS_PORT_6379_TCP_ADDR=10.43.51.106
REDIS_SERVICE_HOST=10.43.51.106
REDIS_SERVICE_PORT=6379
...
```

Isso é inofensivo até a própria aplicação ler uma variável com o mesmo nome. Uma aplicação que espera `REDIS_PORT=6379` passa a receber `tcp://10.43.51.106:6379` e falha ao interpretar, ou uma ferramenta que transforma toda variável `PREFIXO_*` em configuração pega chaves lixo. A correção é uma linha:

```yaml
spec:
  enableServiceLinks: false
```

Verificado: com ela, nenhuma das variáveis `REDIS_*` aparece. Os Services são encontrados por DNS de qualquer forma, então a maioria dos workloads não perde nada. (`KUBERNETES_SERVICE_HOST`/`PORT` do API server são sempre injetadas.)

### Tipos de Secret que você vai encontrar

ConfigMaps não têm tipo. Secrets têm, e o tipo valida as chaves:

| Tipo | Chaves obrigatórias | Uso |
|---|---|---|
| `Opaque` | qualquer uma | credenciais da aplicação (padrão) |
| `kubernetes.io/dockerconfigjson` | `.dockerconfigjson` | credenciais de registry para `imagePullSecrets` |
| `kubernetes.io/tls` | `tls.crt`, `tls.key` | certificados TLS (Ingress, cert-manager) |
| `kubernetes.io/basic-auth` | `username`, `password` | principalmente valor documental |
| `kubernetes.io/service-account-token` | gerenciadas pelo Kubernetes | tokens legados de ServiceAccount de vida longa |

Uma Secret `Opaque` pode ser consumida com `envFrom`/`secretKeyRef` exatamente como uma ConfigMap. Uma Secret `dockerconfigjson` é para o kubelet, não para a aplicação.

### Variáveis de ambiente vs arquivos para configuração

- Variáveis de ambiente são simples, aparecem no `kubectl describe` só como referências e qualquer framework as lê com facilidade. São fixas durante a vida do container.
- Arquivos suportam configuração estruturada (um `application.yaml` inteiro), podem ser atualizados no lugar e vazam menos quando carregam segredos.

## Trade-offs

- **`envFrom` vs `env` explícito.** O `envFrom` é curto e pega chaves novas automaticamente; entradas `env` explícitas documentam exatamente o que a aplicação consome e falham de forma visível quando falta uma chave. Um meio-termo comum: `envFrom` para uma ConfigMap da própria aplicação, `secretKeyRef` explícito para cada segredo.
- **Uma ConfigMap grande vs várias.** Uma por assunto (aplicação, tenant, feature flags) deixa claro quem é dono de quê; cada fonte extra adiciona mais um risco de colisão silenciosa em que a última vence.
- **Reiniciar na mudança vs hot reload.** Reiniciar é previsível e funciona para qualquer aplicação; hot reload de arquivos montados evita restarts, mas exige código que releia a configuração com segurança.

## Lab

Neste lab você recebe um Pod `app` que consome um ConfigMap e um Secret como variáveis de ambiente e está travado em `CreateContainerConfigError`. O seu trabalho é fazê-lo subir, um erro de cada vez, e descobrir de onde vem uma variável que ninguém declarou. A ideia central é que o kubelet reporta só o primeiro problema que encontra (então cada correção revela a próxima falha) e que o Kubernetes injeta variáveis de ambiente por conta própria.

**O cenário**

O teste cria, no namespace `example`, o ConfigMap `app-config` (`APP_MODE=production` e `LOG_LEVEL=info`, compartilhado por todas as apps, então não o altere), o Secret `db-credentials` e um Service `redis` (porta 6379). Depois aplica o seu `app.yaml`. A app se recusa a iniciar se `REDIS_PORT` estiver definida com algo que não é número.

- `src/main/resources/k8s/app.yaml`: o seu arquivo. Usa `envFrom` com dois ConfigMaps (`app-config` e `feature-flags`) e um `env` com `DB_PASSWORD` vindo de um Secret.

O cluster é removido no fim de cada execução, então a pista está nas mensagens de falha, que trazem o estado e a mensagem do Pod.

**O que você vai fazer, passo a passo**

1. **Rodar e corrigir um erro por vez.** Os cinco testes falham de início. Rode de novo depois de cada mudança.
2. **Tornar o `feature-flags` opcional (TODO-00).** Esse ConfigMap só existe em alguns ambientes. Aqui ele não existe e isso não pode impedir o Pod de subir. Veja o que o campo da referência permite.
3. **Corrigir a chave do Secret (TODO-01).** `DB_PASSWORD` aponta para uma chave que o Secret não tem. Liste as chaves com `kubectl -n example describe secret db-credentials` e referencie a certa.
4. **Achar a origem do `REDIS_PORT` (TODO-02).** O Pod sobe e cai com "REDIS_PORT is not a number", e ninguém no arquivo define essa variável. Olhe `kubectl -n example get svc`: o Kubernetes injeta variáveis de ambiente no estilo Docker link para os Services existentes. Desligue isso sem renomear nada; a app encontra o redis por DNS de qualquer forma.
5. **Sobrescrever só neste Pod (TODO-03).** O `app-config` define `LOG_LEVEL=info` para todos. Faça este Pod rodar com `LOG_LEVEL=debug` sem mudar o ConfigMap. Pense na precedência entre `env` e `envFrom`.

**Como saber que terminou**

`mvn -pl kubernetes-concepts/configmaps-and-environment-variables test` passa por inteiro: o Pod fica de pé e sem restarts, `DB_PASSWORD` vale `s3cret`, `APP_MODE` vale `production`, `LOG_LEVEL` vale `debug` com o ConfigMap ainda em `info` e `REDIS_SERVICE_HOST` está vazio. Você deve conseguir explicar por que um erro escondia o outro e por que um Service pode quebrar uma app que nunca o mencionou.

**Desafios opcionais**

- **TODO-04:** adicione `prefix: FF_` à fonte `feature-flags` e crie o ConfigMap com uma chave. Que nome de variável o contêiner recebe? O que acontece se duas fontes de `envFrom` definem a mesma chave?

**Pré-requisitos:** Docker rodando (o teste sobe um container `rancher/k3s` e baixa `busybox` dentro dele), o artigo "ConfigMaps and Environment Variables", Java e Maven.

**Como rodar:** clone o repositório e, na raiz, rode `mvn -pl kubernetes-concepts/configmaps-and-environment-variables test`. A primeira execução baixa a imagem do k3s (cerca de 250 MB). Com o starter quebrado leva uns dois minutos, e depois de corrigido cerca de 30 segundos. Você edita apenas o `app.yaml`.

## Documentation Links

- [Kubernetes docs: ConfigMaps](https://kubernetes.io/docs/concepts/configuration/configmap/): criação, consumo, ConfigMaps imutáveis.
- [Kubernetes docs: Configure a Pod to Use a ConfigMap](https://kubernetes.io/docs/tasks/configure-pod-container/configure-pod-configmap/): `envFrom`, `prefix`, `optional`.
- [Kubernetes docs: Define Environment Variables for a Container](https://kubernetes.io/docs/tasks/inject-data-application/define-environment-variable-container/): `env`, `valueFrom`, variáveis dependentes.
- [Kubernetes docs: Secret types](https://kubernetes.io/docs/concepts/configuration/secret/#secret-types): tipos embutidos e chaves obrigatórias.
