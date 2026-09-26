---
version: 1.0
updatedAt: 2026-09-26
title: "Patches no Kustomize: Strategic Merge vs JSON 6902"
summary: "Os dois formatos de patch, como listas com e sem merge key se comportam, targets por kind, nome e labels, e os modos de falha de cada um."
---
## Objective

Overlays mudam a base com **patches**. O Kustomize suporta dois formatos: um **strategic merge patch** (um YAML parcial do objeto, combinado com uma semântica de listas que conhece o Kubernetes) e um **JSON 6902 patch** (uma lista de operações `add`/`replace`/`remove` em caminhos exatos). Os dois vivem no mesmo campo `patches:`, e os dois podem mirar vários recursos de uma vez com um `target` (por kind, regex de nome, labels ou annotations). Saber como cada um trata listas é a diferença entre adicionar uma variável de ambiente e apagar as outras em silêncio. Este conceito cobre os dois formatos, os targets, e os comportamentos de lista que mordem.

## Use Cases

- Definir resources, réplicas ou variáveis de ambiente extras para um ambiente.
- Aplicar a mesma mudança em todo Deployment com um certo label (todos os workers, todos os Pods web).
- Remover algo que a base define (um sidecar, uma variável, uma probe).
- Inserir ou substituir um item numa posição exata de uma lista.

## Deep Dive

### Strategic merge patch

Um objeto parcial com `apiVersion`, `kind` e `metadata.name` para identificar o alvo:

```yaml
patches:
  - patch: |-
      apiVersion: apps/v1
      kind: Deployment
      metadata: {name: web}
      spec:
        replicas: 3
        template:
          spec:
            containers:
              - name: app                       # casado pelo nome, não pela posição
                resources:
                  requests: {memory: 512Mi}
                  limits: {memory: 1Gi}
                env:
                  - {name: NEW_VAR, value: "1"} # combinado no env pelo nome
```

Mapas são combinados recursivamente. Listas são a parte sutil: os tipos do Kubernetes declaram uma **merge key** para algumas listas, e essas são combinadas item a item; listas sem merge key são **substituídas por inteiro**.

| Lista | Comportamento num strategic merge patch |
|---|---|
| `containers`, `initContainers` | combinada por `name` |
| `env` | combinada por `name` |
| `volumes` | combinada por `name` |
| `volumeMounts` | combinada por `mountPath` |
| `ports` (do container) | combinada por `containerPort` |
| `args`, `command` | **substituída** |
| `envFrom` | **substituída** |
| `imagePullSecrets` | combinada por `name` |

Verificado: um patch com `args: ["worker", "--concurrency=4"]` substituiu completamente os args da base, e uma entrada `env` no patch foi adicionada ao lado das entradas da base. Um patch listando uma fonte `envFrom` substituiu todas as fontes da base, um jeito silencioso de perder a referência a uma ConfigMap.

Diretivas mudam o padrão:

```yaml
env:
  - name: DEBUG_OPTS
    $patch: delete                  # remove este item de uma lista combinada
```

```yaml
containers:
  - name: sidecar
    $patch: delete                  # remove um container inteiro
```

`$patch: replace` funciona em mapas e em listas combinadas. Não use em listas que já são substituídas: verificado, colocar `- $patch: replace` numa lista `envFrom` deixou a diretiva **literalmente** na saída renderizada, como um item de lista inválido.

### JSON 6902 patch

Operações em caminhos exatos. Precisa de um `target` porque o patch em si não nomeia o objeto:

```yaml
patches:
  - target: {kind: Deployment, name: worker}
    patch: |-
      - op: add
        path: /spec/template/spec/containers/0/env/-     # adiciona ao fim da lista
        value: {name: TZ, value: America/New_York}
      - op: replace
        path: /spec/replicas
        value: 3
      - op: remove
        path: /spec/template/spec/containers/0/livenessProbe
```

- Os caminhos usam índices (`containers/0`), então dependem da ordem na base. Reordenar os containers na base muda o alvo do patch em silêncio.
- `-` significa "fim da lista".
- `add` exige que o pai exista. Verificado: `add .../env/-` num container **sem** lista `env` falha o build inteiro com `add operation does not apply: doc is missing path`. Adicione a própria lista (`path: .../env`, `value: [...]`) onde ela pode não existir, ou use um strategic merge patch.
- Operações `test` fazem o patch falhar a não ser que um valor seja o esperado, uma rede de segurança barata para caminhos com índice.

### Targets: um patch, vários recursos

```yaml
patches:
  - target:
      kind: Deployment
      labelSelector: role=worker          # todos os Deployments de worker
    patch: |-
      - op: add
        path: /spec/replicas
        value: 3
  - target:
      kind: Deployment
      name: "web|worker"                  # regex no nome
    path: extra-env.yaml                  # patch num arquivo, strategic ou JSON
```

Campos de target: `group`, `version`, `kind`, `name` (regex), `namespace`, `labelSelector`, `annotationSelector`. Verificado: o patch com `labelSelector: role=worker` definiu `replicas: 3` só no Deployment `worker`.

Um strategic merge patch usado com um `target` é aplicado em cada recurso casado; o `metadata.name` dele passa a ser ignorado no casamento, e é assim que um arquivo "adicione estas variáveis de ambiente" pode servir a todos os Deployments.

### Escolhendo

| Necessidade | Formato |
|---|---|
| Mudar campos, adicionar/sobrescrever variáveis, definir resources | strategic merge |
| Remover um item de uma lista combinada | strategic merge com `$patch: delete` |
| Adicionar a uma lista sem merge key, ou inserir numa posição | JSON 6902 |
| A mesma mudança em vários recursos | qualquer um, com `target` |
| Custom resources (CRDs) | JSON 6902 (sem merge keys conhecidas, o strategic merge substitui todas as listas) |

### Mantendo os patches honestos

- Renderize e revise: `kubectl kustomize overlays/staging | less`. Um patch que não mira nada nem sempre é erro (um `labelSelector` que casa com zero recursos é aplicado zero vezes, em silêncio).
- Prefira arquivos de patch pequenos com nome da intenção (`resources-large.yaml`, `debug-logging.yaml`) a um patch gigante por overlay.
- Quando a base muda a ordem de containers ou de itens de lista, renderize de novo todo overlay que usa caminhos com índice de JSON 6902.

## Trade-offs

- **Strategic merge vs JSON 6902.** O strategic merge se lê como o objeto e sobrevive a reordenações, mas a semântica de listas depende de merge keys escondidas. O JSON 6902 é explícito e preciso, e frágil diante de mudanças de índice e pais inexistentes.
- **Patches com target vs patches por recurso.** Targets eliminam duplicação entre muitos recursos; também deixam menos óbvio, do ponto de vista do recurso, o que o modificou.
- **Aplicar patches vs parametrizar a base.** Muitos patches para o mesmo campo em todo overlay indicam que a base deveria expô-lo de outra forma (um valor de generator, uma replacement ou um component).

## Documentation Links

- [Kustomize reference: patches](https://kubectl.docs.kubernetes.io/references/kustomize/kustomization/patches/): formatos, targets, patches inline e em arquivo.
- [Kubernetes docs: Update API Objects in Place Using kubectl patch](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/update-api-object-kubectl-patch/): semântica do strategic merge, merge keys, diretivas.
- [Strategic merge patch design](https://github.com/kubernetes/community/blob/master/contributors/devel/sig-api-machinery/strategic-merge-patch.md): `$patch`, `$retainKeys`, regras de listas.
- [RFC 6902: JSON Patch](https://datatracker.ietf.org/doc/html/rfc6902): operações e sintaxe de caminhos.
