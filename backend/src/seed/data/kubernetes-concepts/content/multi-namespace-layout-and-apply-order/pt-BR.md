---
version: 1.0
updatedAt: 2026-09-26
title: "Layout com Vários Namespaces e Ordem de Aplicação"
summary: "Serviços compartilhados e aplicações em namespaces separados, o que atravessa a fronteira de um namespace, e uma ordem de aplicação que funciona num cluster vazio."
---
## Objective

Um cluster raramente roda uma única aplicação. Ele roda serviços compartilhados (um cache, uma fila, um banco de dados), mais várias aplicações de times diferentes, mais ferramentas. Dar a cada grupo o seu namespace, com os serviços compartilhados num namespace próprio, mantém as aplicações independentes e as partes compartilhadas reutilizáveis. Também cria dependências entre namespaces que decidem a ordem em que as coisas precisam ser aplicadas. Este conceito cobre esse layout, como as aplicações alcançam os serviços compartilhados, o que pode e o que não pode atravessar a fronteira de um namespace, e uma ordem de aplicação confiável.

## Use Cases

- Rodar as aplicações de `team-a` e `team-b` lado a lado contra um cache e uma fila compartilhados.
- Apagar ou recriar o namespace de uma aplicação sem tocar nas outras nem nos dados compartilhados.
- Fazer o bootstrap de um cluster vazio na ordem certa a partir de um script.
- Decidir onde um componente novo deve ficar.

## Deep Dive

### Um layout por namespace

```
k8s/
  00-namespaces/          # objetos Namespace + labels (Pod Security, dono)
  10-shared/              # serviços compartilhados: redis, uma fila, um banco   -> ns shared
  20-apps/
    team-a/               # overlay do Kustomize                                -> ns team-a
    team-b/               # overlay do Kustomize                                -> ns team-b
  90-tooling/             # dashboards, ferramentas de administração            -> ns tooling
```

- **Serviços compartilhados ganham o seu próprio namespace** (`shared`). O ciclo de vida deles é diferente do de qualquer aplicação: você apaga e recria namespaces de aplicação, quase nunca apaga os dados compartilhados.
- **Cada aplicação** vive no seu namespace, normalmente renderizado a partir de um overlay do Kustomize que define `namespace:`, a tag da imagem e a sua própria configuração e Secrets.
- **Ferramentas** que precisam de privilégios no cluster todo ficam isoladas, para que RBAC e NetworkPolicies as tratem à parte.

Namespaces são baratos. A pergunta para cada componente novo é "o ciclo de vida de quem ele compartilha?". Um cache usado só por `team-a` pertence a `team-a`; um usado por todas as aplicações pertence a `shared`.

### O que atravessa a fronteira de um namespace

| Coisa | Entre namespaces? |
|---|---|
| Tráfego de rede para um Service | sim, por DNS (`redis.shared.svc.cluster.local`), a não ser que uma NetworkPolicy bloqueie |
| Montar uma Secret, ConfigMap ou PVC | **não**, só do próprio namespace do Pod |
| Service de backend de um Ingress | **não**, um Ingress só roteia para Services do seu namespace |
| Rota da Gateway API para um Service | sim, com um `ReferenceGrant` no namespace de destino |
| RBAC | Roles são de namespace; ClusterRoles podem ser vinculadas por namespace |

Então cada aplicação precisa da **sua própria cópia** das credenciais que usa nos serviços compartilhados: uma Secret `cache-credentials` em `team-a` com o usuário do time A, outra em `team-b` com o do time B. Isso é uma vantagem: cada aplicação tem a sua identidade, e apagar o namespace dela não revoga nada compartilhado. Com muitos namespaces, o External Secrets Operator ou um pequeno script de bootstrap mantém essas cópias sincronizadas.

### Por que a ordem importa

O Kubernetes é eventualmente consistente. Aplicadas fora de ordem, a maioria das coisas converge: uma aplicação que sobe antes do seu cache entra em crash loop até o cache ficar de pé, e então se recupera. Mas algumas ordens falham de vez:

1. **Namespaces antes de qualquer coisa dentro deles.** Verificado: aplicar uma ConfigMap e o seu Namespace num `kubectl apply -f` comum, com a ConfigMap primeiro, falha com `namespaces "zzz-new" not found` (o Namespace ainda é criado, então uma segunda execução funciona). A saída do `kubectl kustomize` ordena o `Namespace` primeiro, então o `apply -k` dos mesmos arquivos funciona de primeira. Concatenar arquivos à mão perde essa garantia.
2. **CRDs antes de custom resources.** Um `Certificate` ou `ServiceMonitor` aplicado na mesma execução que o seu CRD falha com `no matches for kind` até o CRD estar estabelecido. Instale operators e CRDs (cert-manager, Prometheus Operator) num passo anterior e use `kubectl wait --for condition=established crd/<nome>`.
3. **Dependências stateful antes de quem as consome**, para uma subida limpa, sem crash loops.
4. **Objetos que afetam o admission primeiro**: labels de Pod Security nos Namespaces, LimitRanges e ResourceQuotas precisam existir antes de os Pods serem criados, senão esses Pods escapam deles até serem recriados.

### Uma ordem de bootstrap

```bash
set -euo pipefail
kubectl apply -k k8s/00-namespaces

kubectl apply -k k8s/10-shared
kubectl -n shared rollout status deploy/redis --timeout=300s

for team in team-a team-b; do
  kubectl apply -k k8s/20-apps/$team
done
for team in team-a team-b; do
  kubectl -n $team rollout status deploy/web --timeout=300s
done

kubectl apply -k k8s/90-tooling
```

O `rollout status` transforma "eventualmente" em "agora, ou o script falha com uma mensagem clara". O mesmo script pode rodar de novo num cluster existente com segurança, porque todo passo é um `apply`.

### Apagando uma aplicação

```bash
kubectl delete namespace team-b
```

Tudo no namespace vai embora, incluindo os PVCs (e, com reclaim policy `Delete`, os dados deles). Os serviços compartilhados não são tocados, mas o que o time B guardou neles (chaves, filas, schemas de banco) permanece, o que normalmente é o que você quer (recrie o namespace e ele reencontra os dados), e às vezes é um resto para limpar à mão.

## Trade-offs

- **Namespace de serviços compartilhados vs serviços por aplicação.** Compartilhar economiza memória num cluster pequeno (uma instância em vez de várias) e amarra as aplicações à disponibilidade e às atualizações dessa instância. Serviços por aplicação isolam falhas e multiplicam o uso de recursos.
- **Credenciais copiadas vs acesso entre namespaces.** Cópias por namespace são mais objetos para gerenciar e dão a cada aplicação a sua identidade e o seu raio de impacto.
- **Ordem por script vs sync waves de GitOps.** Um script de bootstrap é explícito e fácil de ler; sync waves do Argo CD ou `dependsOn` do Flux expressam a mesma ordem de forma declarativa e continuam aplicando-a o tempo todo.

## Lab

Neste lab você recebe um script de deploy que só faz `kubectl apply -f /lab/deploy/` e que falha num cluster vazio. Seu trabalho é fazer o script funcionar na primeira tentativa, sem erro nenhum, organizando a ordem em que as coisas são criadas e esperando o que precisa ser esperado. A ideia central é sentir que o `kubectl apply` de um diretório não entende dependências: ele aplica em ordem alfabética, um objeto customizado não pode nascer no mesmo passo que a sua definição, e o script só deve voltar quando o app estiver realmente disponível. Rodar duas vezes ou tentar de novo até dar certo não é a correção.

**O cenário**

O diretório `src/main/resources/deploy/` guarda os objetos de uma loja, e o teste o copia para `/lab/deploy` num nó novo do k3s (iniciado pelo Testcontainers) e roda o seu `deploy.sh`.

- `namespace.yaml`: o Namespace `shop`.
- `app.yaml`: um ConfigMap `web-config` e um Deployment `web` em `shop`. O app leva alguns segundos para ficar pronto (o readinessProbe só passa depois de um `sleep 5`).
- `widget-crd.yaml`: a CustomResourceDefinition do tipo `Widget`.
- `widget.yaml`: um `Widget` chamado `default-widget` em `shop`.
- `src/main/resources/deploy.sh`: o script que você edita, com um `TODO` para cada defeito.

Você pode reorganizar `deploy/` à vontade: novos diretórios e arquivos `kustomization.yaml`.

**O que você vai fazer, passo a passo**

1. **Rode os testes e leia os erros da primeira execução.** A mensagem de falha lista todos os erros que o `kubectl` imprimiu.
2. **Criar o Namespace antes do que há dentro dele (TODO-00).** A ordem alfabética coloca `app.yaml` antes de `namespace.yaml`. Organize o diretório com Kustomize (arquivos `kustomization.yaml`) para que cada objeto seja criado depois do que ele precisa.
3. **Criar o Widget só depois que o CRD é servido (TODO-01).** Um recurso customizado não pode ser criado no mesmo passo que o seu CRD. Aplique o CRD primeiro e espere até o servidor de API servir o novo tipo, e só então aplique o resto.
4. **Esperar o app (TODO-02).** O `kubectl apply` volta assim que os objetos são aceitos, não quando o Pod está pronto. Faça o script voltar só quando o `deploy/web` estiver disponível.

**Como saber que terminou**

`mvn -pl kubernetes-concepts/multi-namespace-layout-and-apply-order test` passa em `firstRunSucceedsWithoutErrors` (saída 0 e nada de "error" no stderr), `everythingIsCreated`, `returnsOnlyWhenWebIsAvailable` e `secondRunSucceedsToo`. Você deve conseguir explicar por que cada espera existe e por que o script também funciona rodando pela segunda vez.

**Desafios opcionais**

- **TODO-03:** coloque o CRD e o `Widget` no mesmo kustomization e aplique uma vez só. O Kustomize ordena os CRDs primeiro; por que ainda assim falha?

**Pré-requisitos:** Docker rodando (os testes sobem um container `rancher/k3s` e baixam `busybox` dentro dele), Java e Maven, e o artigo Multi-Namespace Layout and Apply Order.

**Como rodar:** clone o repositório e, a partir da raiz, rode `mvn -pl kubernetes-concepts/multi-namespace-layout-and-apply-order test`. Os comentários `TODO-00`, `TODO-01` e `TODO-02` em `deploy.sh` marcam o que falta.

## Documentation Links

- [Kubernetes docs: Namespaces](https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/): escopo, DNS, quando usar vários.
- [Kubernetes docs: Share a Cluster with Namespaces](https://kubernetes.io/docs/tasks/administer-cluster/namespaces/): criando e apagando namespaces.
- [Gateway API: ReferenceGrant](https://gateway-api.sigs.k8s.io/reference/api-types/referencegrant/): permitindo referências entre namespaces.
- [Kubernetes docs: Multi-tenancy](https://kubernetes.io/docs/concepts/security/multi-tenancy/): opções de isolamento entre times ou tenants.
