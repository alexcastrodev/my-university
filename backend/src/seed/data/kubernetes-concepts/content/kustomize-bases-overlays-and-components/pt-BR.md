---
version: 1.0
updatedAt: 2026-09-26
title: "Kustomize: Bases, Overlays e Components"
summary: "Camadas de YAML puro com bases, overlays e components opcionais, labels vs commonLabels, e como pré-visualizar com kubectl kustomize e kubectl diff."
---
## Objective

O Kustomize monta manifests do Kubernetes empilhando YAML puro, sem linguagem de template. Uma **base** guarda o que todo ambiente compartilha, um **overlay** pega uma base e muda o que difere (namespace, tag da imagem, réplicas, configuração), e um **component** é uma fatia opcional e reutilizável de mudanças em que vários overlays podem entrar. Ele vem embutido no `kubectl` (`kubectl apply -k`), o que o torna o jeito sem dependências de implantar a mesma aplicação em vários ambientes. Este conceito cobre o layout de diretórios, como as peças se compõem, e como ver exatamente o que vai mudar antes de aplicar.

## Use Cases

- Uma aplicação implantada em staging e produção (ou por cliente) a partir de um único conjunto de manifests.
- Funcionalidades opcionais ligadas por ambiente: logs de debug, um worker extra, um sidecar de monitoramento.
- Revisar o YAML renderizado completo de uma mudança num pull request.
- Conferir o que o `apply` mudaria no cluster ao vivo antes de rodá-lo.

## Deep Dive

### Layout

```
k8s/
  base/
    kustomization.yaml
    deployment.yaml          # Deployments web e worker
    job.yaml                 # Job migrate
  components/
    debug/
      kustomization.yaml     # kind: Component
  overlays/
    staging/
      kustomization.yaml
      db.env                 # nunca commitado
    production/
      kustomization.yaml
      db.env
```

A base, sem saber nada de ambientes:

```yaml
# base/kustomization.yaml
resources: [deployment.yaml, job.yaml]
labels:
  - pairs: {app.kubernetes.io/part-of: web-app}
configMapGenerator:
  - name: app-config
    literals: [LOG_LEVEL=info, FEATURE_X=false]
```

Um component, um delta reutilizável:

```yaml
# components/debug/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1alpha1
kind: Component
configMapGenerator:
  - name: app-config
    behavior: merge
    literals: [LOG_LEVEL=debug]
```

Um overlay que usa os dois:

```yaml
# overlays/staging/kustomization.yaml
namespace: web-staging
resources: [../../base]
components: [../../components/debug]
images:
  - name: registry.example.com/demo/web-app
    newName: registry.internal:5000/demo/web-app
    newTag: "1.4.2"
configMapGenerator:
  - name: app-config
    behavior: merge
    literals: [FEATURE_X=true, ENVIRONMENT=staging]
secretGenerator:
  - name: db-credentials
    envs: [db.env]
```

### O que o build produz

Verificado com `kubectl kustomize overlays/staging` (kubectl 1.36, Kustomize v5.8):

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config-g5t6m8m4hk
  namespace: web-staging
  labels: {app.kubernetes.io/part-of: web-app}
data:
  ENVIRONMENT: staging
  FEATURE_X: "true"
  LOG_LEVEL: debug           # vindo do component
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: web-staging
  labels: {app.kubernetes.io/part-of: web-app, role: web}
spec:
  template:
    spec:
      containers:
        - name: app
          image: registry.internal:5000/demo/web-app:1.4.2
          envFrom:
            - configMapRef: {name: app-config-g5t6m8m4hk}      # referência reescrita
            - secretRef: {name: db-credentials-dfcfkgfmh9}
```

- `namespace:` é aplicado a todo recurso de namespace.
- A ConfigMap combina os valores da base, do component e do overlay, e o nome dela ganha um hash do conteúdo que todas as referências acompanham.
- O transformer de imagens reescreveu a imagem nos dois Deployments **e** no Job.
- A Secret gerada no overlay não recebeu os `labels` da base (labels declarados numa kustomization valem para os recursos dela e abaixo, não para o que um overlay gera).

A ordem das operações: os recursos de `resources:` são carregados (montados recursivamente se forem diretórios com kustomization), os components são aplicados, e depois os transformers e generators do próprio overlay.

### resources vs components

- `resources:` são coisas que existem por conta própria: arquivos ou outras kustomizations. Adicionar a mesma base duas vezes é erro (IDs duplicados).
- `components:` são aplicados **sobre** os recursos acumulados e podem aplicar patches, adicionar generators e adicionar recursos. São a resposta para "estes três overlays precisam das configurações de debug, aqueles dois não" sem copiar e colar nem cadeias profundas de herança.

Mantenha a herança rasa: base, depois overlay, com components para funcionalidades opcionais. Overlays sobre overlays sobre overlays ficam difíceis de entender.

### labels vs commonLabels

```yaml
labels:
  - pairs: {app.kubernetes.io/part-of: web-app}
    includeSelectors: false      # padrão: só metadata
```

O `commonLabels` está deprecado (o Kustomize imprime `Warning: 'commonLabels' is deprecated. Please use 'labels' instead`). Ele também adicionava labels aos selectors, e como o `spec.selector` de um Deployment é imutável, adicionar um label comum depois do primeiro deploy quebra todo apply seguinte. `labels` sem `includeSelectors` só mexe em metadata, que é quase sempre o que você quer.

### Pré-visualize antes de aplicar

```bash
kubectl kustomize overlays/staging                    # renderiza na saída padrão
kubectl kustomize overlays/staging > /tmp/stg.yaml    # revisar ou arquivar como artefato
kubectl diff -k overlays/staging                      # cluster ao vivo vs resultado renderizado
kubectl apply -k overlays/staging
```

O `kubectl diff` pede ao API server para calcular o que o `apply` produziria (dry run no servidor) e mostra um diff unificado contra os objetos ao vivo. Os exit codes o tornam scriptável: `0` sem diferenças, `1` com diferenças, maior que `1` erro.

Armadilha verificada: quando uma tag de imagem alterada afeta um Job imutável, o `kubectl diff -k` sai com `2` e imprime `field is immutable` para o Job, porque o servidor rejeita o dry run. Pipelines que tratam qualquer código diferente de zero como "tem mudanças" leem isso errado. Trate o Job separadamente (veja o conceito de Jobs).

O binário `kustomize` independente costuma ser mais novo que o embutido no kubectl (`kubectl version --client` imprime a versão do Kustomize embutido). Use o mesmo no CI e localmente para evitar diferenças de renderização.

## Trade-offs

- **Kustomize vs Helm.** O Kustomize mantém os manifests como YAML válido e legível e não precisa de nada além do kubectl, mas não tem empacotamento, versionamento nem histórico de releases. O Helm é melhor para distribuir software a terceiros; o Kustomize costuma ser mais simples para as suas próprias aplicações. Os dois também se combinam: `helmCharts:` no Kustomize, ou o Kustomize como post-renderer do Helm.
- **Components vs mais overlays.** Components evitam duplicação de funcionalidades opcionais; components demais dificultam ver o que um ambiente contém sem renderizá-lo.
- **Renderizar no CI vs aplicar direto.** Arquivar o YAML renderizado dá um registro exato do que foi implantado; aplicar com `-k` direto é mais simples e depende da versão do Kustomize na hora do apply.

## Documentation Links

- [Kubernetes docs: Declarative Management of Kubernetes Objects Using Kustomize](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/kustomization/): bases, overlays, generators, `kubectl apply -k`.
- [Kustomize docs: Components](https://kubectl.docs.kubernetes.io/guides/config_management/components/): o kind Component e seus usos.
- [Kustomize reference: kustomization file](https://kubectl.docs.kubernetes.io/references/kustomize/kustomization/): todos os campos.
- [kubectl diff reference](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_diff/): exit codes e dry run no servidor.
