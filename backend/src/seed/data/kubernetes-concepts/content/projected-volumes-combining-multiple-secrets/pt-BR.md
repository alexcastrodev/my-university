---
version: 1.0
updatedAt: 2026-09-25
title: "Projected Volumes: Combinando Várias Secrets"
summary: "Montar várias Secrets em um único diretório com um volume projected, a colisão silenciosa de chaves em que a última source vence, e como items/path mantém os tenants separados."
---
## Objective

Um volume `secret` comum monta exatamente uma Secret. Quando um container precisa de credenciais de várias Secrets (uma por tenant, uma por sistema externo), um volume `projected` junta todas em um único diretório. É o jeito mais limpo de dar à aplicação um lugar conhecido, como `/run/secrets`, de onde ler tudo. Ele também tem uma armadilha: quando duas sources têm a mesma chave, o Kubernetes não falha nem avisa, e a última source vence em silêncio. Este conceito cobre o volume projected, essa colisão, e como `items` e `path` mantêm as sources separadas.

## Use Cases

- Um serviço multi-tenant que precisa das credenciais de `tenant-alpha` e `tenant-beta` ao mesmo tempo, com cada Secret tendo dono e rotação independentes.
- Um único ponto de montagem com credenciais, configuração e metadados do Pod juntos (sources `secret` + `configMap` + `downwardAPI`).
- Alimentar o import `configtree:` do Spring Boot, que transforma uma árvore de diretórios em propriedades de configuração.
- Um token de ServiceAccount de curta duração e com audience definida (source `serviceAccountToken`) ao lado das Secrets da própria aplicação.

## Deep Dive

### O ponto de partida

Duas Secrets criadas a partir de env files:

```bash
kubectl -n example create secret generic tenant-alpha \
  --from-env-file=secrets/example/alpha.env

kubectl -n example create secret generic tenant-beta \
  --from-env-file=secrets/example/beta.env
```

E um volume projected que monta as duas no mesmo diretório:

```yaml
volumes:
  - name: secrets
    projected:
      sources:
        - secret:
            name: tenant-alpha
        - secret:
            name: tenant-beta

volumeMounts:
  - name: secrets
    mountPath: /run/secrets
    readOnly: true
```

Cada chave de cada source vira um arquivo com o nome da chave: `/run/secrets/<CHAVE>`, conteúdo = valor. Com chaves disjuntas, é exatamente o que você quer.

### A colisão silenciosa

Env files do mesmo tipo de sistema tendem a usar os mesmos nomes:

```
# alpha.env                      # beta.env
DB_USER=alpha_app                DB_USER=beta_app
DB_PASSWORD=alpha-s3cret         DB_PASSWORD=beta-s3cret
ALPHA_API_KEY=ak-alpha-111       BETA_WEBHOOK_TOKEN=wt-beta-222
```

As duas Secrets agora têm `DB_USER` e `DB_PASSWORD`, e as duas querem escrever `/run/secrets/DB_PASSWORD`. O que acontece, verificado no k3s v1.36:

```bash
$ kubectl -n example exec app -- cat /run/secrets/DB_PASSWORD
beta-s3cret
```

O API server aceita o Pod, o kubelet monta o volume, nenhum evento é emitido, e a **última source da lista vence**. A aplicação do tenant alpha agora autentica com a senha do tenant beta. Inverta a ordem das sources e o resultado inverte junto. Compare com o próprio `kubectl create secret`, que recusa chave duplicada na hora (`cannot add key DB_PASSWORD, another key by that name already exists`): a checagem que você tem na criação não existe na projeção.

### Separando as sources com `items`

`items` mapeia uma chave para um caminho dentro do volume, e o caminho pode ter diretórios:

```yaml
volumes:
  - name: secrets
    projected:
      sources:
        - secret:
            name: tenant-alpha
            items:
              - key: DB_USER
                path: alpha/DB_USER
              - key: DB_PASSWORD
                path: alpha/DB_PASSWORD
              - key: ALPHA_API_KEY
                path: alpha/ALPHA_API_KEY
        - secret:
            name: tenant-beta
            items:
              - key: DB_USER
                path: beta/DB_USER
              - key: DB_PASSWORD
                path: beta/DB_PASSWORD
              - key: BETA_WEBHOOK_TOKEN
                path: beta/BETA_WEBHOOK_TOKEN
```

Resultado:

```
/run/secrets/alpha/DB_USER        alpha_app
/run/secrets/alpha/DB_PASSWORD    alpha-s3cret
/run/secrets/alpha/ALPHA_API_KEY  ak-alpha-111
/run/secrets/beta/DB_USER         beta_app
/run/secrets/beta/DB_PASSWORD     beta-s3cret
/run/secrets/beta/BETA_WEBHOOK_TOKEN  wt-beta-222
```

Duas propriedades de `items` para ter em mente:

- **É uma allow-list.** Assim que uma source tem `items`, só as chaves listadas são projetadas. Uma chave esquecida (digamos `ALPHA_API_KEY`) não é erro, ela simplesmente não está lá.
- **Uma chave listada que não existe é erro.** O volume não monta e o Pod fica em `ContainerCreating` com um evento `FailedMount` (`references non-existent secret key`), a menos que a source esteja marcada com `optional: true`. O mesmo vale para uma Secret inexistente.

### Como a montagem fica no disco

```
$ ls -la /run/secrets
..2026_09_25_09_19_37.1291824148/
..data -> ..2026_09_25_09_19_37.1291824148
alpha -> ..data/alpha
beta -> ..data/beta
```

O kubelet escreve cada nova versão em um diretório novo com timestamp e depois troca o symlink `..data`, então a atualização é atômica: quem lê nunca vê metade das credenciais antigas do alpha e metade das novas. `readOnly: true` vale para a montagem inteira, subdiretórios incluídos, e o volume é `tmpfs`, nunca escrito no disco do nó.

As permissões dos arquivos vêm de `defaultMode` no volume projected (padrão `0644`), ou de `mode` por item. `0400` é um endurecimento comum quando o container roda com um usuário não-root conhecido.

### Misturando tipos de source

As sources não se limitam a Secrets:

```yaml
projected:
  sources:
    - secret:
        name: tenant-alpha
        items: [{ key: DB_PASSWORD, path: alpha/DB_PASSWORD }]
    - configMap:
        name: app-settings
    - downwardAPI:
        items:
          - path: pod/namespace
            fieldRef: { fieldPath: metadata.namespace }
    - serviceAccountToken:
        audience: vault
        expirationSeconds: 3600
        path: tokens/vault
```

Todas as Secrets e ConfigMaps referenciados precisam estar no namespace do Pod. A mesma regra de colisão vale entre tipos de source diferentes (uma chave `DB_PASSWORD` num ConfigMap listado depois sobrescreve a da Secret), então dê a cada source o seu próprio diretório.

### Lendo a partir da aplicação

O Spring Boot lê uma árvore de diretórios diretamente como configuração:

```properties
spring.config.import=optional:configtree:/run/secrets/
```

Nomes de pastas e arquivos formam o nome da propriedade, então `/run/secrets/alpha/DB_PASSWORD` vira `alpha.DB_PASSWORD`. Os diretórios por tenant criados com `items` viram, de graça, prefixos de propriedade por tenant.

## Trade-offs

- **Um volume projected vs um volume `secret` por Secret.** Volumes separados em caminhos separados tornam a colisão impossível por construção, mas cada tenant novo mexe em `volumes` e em `volumeMounts`. Um volume projected é um único ponto de montagem, ao preço de você mesmo ter que separar as chaves.
  ```yaml
  # alternativa à prova de colisão: uma montagem por Secret
  volumeMounts:
    - { name: alpha, mountPath: /run/secrets/alpha, readOnly: true }
    - { name: beta,  mountPath: /run/secrets/beta,  readOnly: true }
  ```
- **`items` faz o spec do Pod depender da lista de chaves.** Adicionar uma chave na Secret não chega à aplicação até o spec do Pod listá-la também. É explícito e revisável, mas também é mais um lugar para esquecer.
- **O last-wins silencioso é um bug de runtime, não um erro de deploy.** Nada no cluster o detecta. Cubra com um teste que lê os arquivos montados, como faz o lab, ou com uma policy (Kyverno, OPA Gatekeeper) que exija `items` em sources de secret dentro de volumes projected.

## Documentation Links

- [Kubernetes docs: Projected Volumes](https://kubernetes.io/docs/concepts/storage/projected-volumes/): sources suportadas, `items`, `defaultMode`, `serviceAccountToken`.
- [Kubernetes docs: Secrets](https://kubernetes.io/docs/concepts/configuration/secret/): Secrets como arquivos, `optional`, atualizações automáticas.
- [Configure a Pod to Use a Projected Volume for Storage](https://kubernetes.io/docs/tasks/configure-pod-container/configure-projected-volume-storage/): tarefa passo a passo.
- [Spring Boot docs: Using Configuration Trees](https://docs.spring.io/spring-boot/reference/features/external-config.html#features.external-config.files.configtree): import `configtree:` e como caminhos viram nomes de propriedade.
