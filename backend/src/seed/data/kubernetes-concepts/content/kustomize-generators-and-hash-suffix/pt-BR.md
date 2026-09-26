---
version: 1.0
updatedAt: 2026-09-26
title: "Generators do Kustomize e o Sufixo de Hash"
summary: "configMapGenerator e secretGenerator a partir de literals, env files e arquivos, merge e replace entre camadas, e como o sufixo de hash dispara rollouts."
---
## Objective

O Kustomize consegue criar ConfigMaps e Secrets a partir de literals, arquivos `.env` e arquivos comuns, em vez de você escrevê-las em YAML. Os objetos gerados ganham um **sufixo de hash** calculado a partir do conteúdo (`app-config-g5t6m8m4hk`), e o Kustomize reescreve todas as referências a eles. A consequência é o principal motivo para usar generators: mude um valor, e os templates de Pod que o referenciam mudam também, o que dispara um rolling update automaticamente. Este conceito cobre `configMapGenerator` e `secretGenerator` (literals, `envs`, `files`, `type`), `behavior: merge` e `replace` entre camadas, o sufixo de hash e quando desligá-lo.

## Use Cases

- Configuração por ambiente empilhada sobre padrões compartilhados.
- Criar as Secrets de banco e de registry de um ambiente a partir de arquivos `.env` e JSON locais que nunca entram no Git.
- Reiniciar Pods automaticamente quando a configuração deles muda.
- Objetos que ferramentas externas referenciam por um nome fixo (e que por isso não podem ganhar sufixo).

## Deep Dive

### configMapGenerator

```yaml
configMapGenerator:
  - name: app-config
    literals:
      - LOG_LEVEL=INFO
      - FEATURE_X=false
    envs:
      - app.env                      # linhas CHAVE=VALOR, cada uma vira uma chave
    files:
      - application.yaml             # chave = nome do arquivo, valor = conteúdo
      - logging=logging-prod.yaml    # chave renomeada para "logging"
```

`literals` e `envs` produzem uma chave por variável, ideal para `envFrom`. `files` produz uma chave por arquivo, ideal para montagem em volume.

### Camadas: behavior merge e replace

Um generator num overlay com o mesmo nome de um da base precisa dizer o que fazer. Verificado: omitir o `behavior` falha o build:

```
Error: merging from generator ... ConfigMap ... Name:"app-config" ... exists;
can not use behavior: 'unspecified', behavior must be merge or replace
```

- `behavior: merge` adiciona chaves e sobrescreve as existentes. Verificado: base `LOG_LEVEL=info, FEATURE_X=false` + component `LOG_LEVEL=debug` + overlay `FEATURE_X=true, ENVIRONMENT=staging` produziram `ENVIRONMENT=staging, FEATURE_X=true, LOG_LEVEL=debug`.
- `behavior: replace` descarta os dados da base por completo. Verificado: `replace` com `ONLY=1` produziu uma ConfigMap contendo só `ONLY: "1"`.
- `behavior: create` (o padrão) exige que ainda não exista objeto com esse nome.

### secretGenerator

```yaml
secretGenerator:
  - name: db-credentials
    envs: [db.env]                                   # DB_USER=..., DB_PASSWORD=...
  - name: client-tls
    files: [ca.crt, client.properties]
  - name: regcred
    type: kubernetes.io/dockerconfigjson
    files: [.dockerconfigjson=registry-config.json]
  - name: api-tls
    type: kubernetes.io/tls
    files: [tls.crt=certs/api.crt, tls.key=certs/api.key]
```

- O `type` padrão é `Opaque`. Secrets tipadas precisam dos nomes de chave certos (`.dockerconfigjson`, `tls.crt`/`tls.key`), daí a sintaxe de renomear `chave=arquivo`.
- Os arquivos de origem são lidos na hora do build a partir do diretório do overlay. Mantenha-os fora do Git (`.gitignore`), num gerenciador de senhas, ou criptografados (SOPS com um plugin do Kustomize como o KSOPS). Um secretGenerator cujo `.env` está commitado em texto puro não é melhor que um YAML de Secret commitado.
- As regras do env file são as mesmas do `kubectl --from-env-file`: um `CHAVE=VALOR` por linha, comentários com `#`, e aspas mantidas literalmente como parte do valor.

### O sufixo de hash e rollouts automáticos

O nome gerado é `<nome>-<hash do conteúdo>`, e o Kustomize reescreve as referências em `envFrom`, `env.valueFrom`, `volumes`, `imagePullSecrets` e outros campos conhecidos. Verificado no build do overlay: `configMapRef: {name: app-config-g5t6m8m4hk}` e `secretRef: {name: db-credentials-dfcfkgfmh9}`.

Mude um valor e o hash muda, então:

1. uma ConfigMap **nova** é criada (a antiga não é modificada),
2. o template de Pod do Deployment passa a referenciar o nome novo,
3. a mudança de template dispara um rolling update normal,
4. voltar o Deployment (`rollout undo`) restaura a referência à ConfigMap antiga, que ainda existe, então configuração e código voltam juntos.

Sem o sufixo, atualizar uma ConfigMap não muda nada nos Pods em execução que a leem como variáveis de ambiente, e nada os reinicia.

O outro lado: ConfigMaps e Secrets geradas antigas nunca são apagadas pelo `kubectl apply -k`. Elas se acumulam. Limpe periodicamente, ou aplique com pruning (`kubectl apply --prune` com um label selector, ou ApplySets), sabendo que o pruning remove o objeto antigo de que o `rollout undo` precisaria.

### Desligando o sufixo

Alguns consumidores precisam de um nome estável: uma Secret referenciada no `tls.secretName` de um Ingress gerenciado por outra ferramenta, uma ConfigMap lida pelo nome por um operator, uma Secret de registry aplicada numa ServiceAccount.

```yaml
generatorOptions:
  disableNameSuffixHash: true        # para todo generator desta kustomization
```

ou por generator:

```yaml
secretGenerator:
  - name: regcred
    type: kubernetes.io/dockerconfigjson
    files: [.dockerconfigjson=registry-config.json]
    options:
      disableNameSuffixHash: true
```

Verificado: com `disableNameSuffixHash: true` as Secrets ficaram exatamente com os nomes `regcred` e `certs`. Você perde então o rollout automático desses objetos; reinicie os consumidores você mesmo depois de mudá-los (`kubectl rollout restart`).

O `generatorOptions` também define `labels` e `annotations` nos objetos gerados, e `immutable: true` os marca como imutáveis (menos watches no API server; qualquer mudança precisa produzir um nome novo, o que o hash já faz).

## Trade-offs

- **Sufixo de hash vs nomes estáveis.** O sufixo dá rollouts de configuração automáticos e reversíveis e acumula objetos antigos; nomes estáveis são simples de referenciar e exigem restarts manuais.
- **Generators vs ConfigMaps em YAML.** Generators mantêm a configuração em formatos naturais (`.env`, `.yaml`, `.conf`) e adicionam o hash; objetos YAML puros são exatamente o que você vê, sem referências reescritas.
- **Secrets de arquivos locais vs um gerenciador de segredos.** Arquivos locais são simples e dependem da máquina que roda o build; External Secrets Operator ou Sealed Secrets mantêm os segredos reproduzíveis a partir do Git ou de um cofre, ao custo de mais um componente.

## Documentation Links

- [Kustomize reference: configMapGenerator](https://kubectl.docs.kubernetes.io/references/kustomize/kustomization/configmapgenerator/): fontes, behavior, options.
- [Kustomize reference: secretGenerator](https://kubectl.docs.kubernetes.io/references/kustomize/kustomization/secretgenerator/): Secrets tipadas e chaves de arquivo.
- [Kustomize reference: generatorOptions](https://kubectl.docs.kubernetes.io/references/kustomize/kustomization/generatoroptions/): sufixo de hash, labels, immutable.
- [Kubernetes docs: Managing Secrets using Kustomize](https://kubernetes.io/docs/tasks/configmap-secret/managing-secret-using-kustomize/): exemplo de ponta a ponta.
