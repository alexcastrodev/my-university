---
version: 1.0
updatedAt: 2026-09-26
title: "Bootstrap Idempotente do Cluster"
summary: "Um script de bootstrap que pode rodar de novo com segurança: comandos idempotentes e não idempotentes, o padrão dry-run e apply, esperas explícitas e testes de reconstrução."
---
## Objective

Um cluster que só pode ser reconstruído por alguém que se lembra de 30 comandos é um cluster que você vai reconstruir errado. O objetivo é um script que leva uma máquina nova a uma plataforma funcionando por completo, e que pode **rodar de novo com segurança** num cluster que já está de pé: cada passo ou converge para o estado desejado ou não faz nada. Este conceito cobre quais comandos são naturalmente idempotentes e quais não são, padrões que transformam os segundos nos primeiros, espera por prontidão entre os passos, e validação do resultado com uma reconstrução do zero.

## Use Cases

- Reconstruir um cluster de nó único depois de perder o disco, como parte de um teste de restauração.
- Subir um nó idêntico de laboratório, staging e produção.
- Rodar o bootstrap de novo depois de uma falha parcial, sem limpar nada antes.
- Tornar o ambiente inteiro revisável no Git.

## Deep Dive

### Idempotente ou não

| Comando | Comportamento ao rodar de novo |
|---|---|
| `snap install microk8s --channel=...` | não faz nada se já instalado (use `snap refresh` para mudar de canal) |
| `microk8s enable <addon>` | verificado: `Addon core/dns is already enabled`, exit code 0 |
| `kubectl apply -f` / `-k` | converge para o manifest; não faz nada se nada mudou |
| `kubectl create namespace demo` | verificado: `Error from server (AlreadyExists)`, exit code 1 |
| `kubectl create secret ...` | falha se já existe |
| `helm install` | falha se o release existe (`helm upgrade --install` converge) |

A regra: **declare, depois aplique**. Qualquer coisa que você faria com `create` imperativo pode virar um apply:

```bash
kubectl create namespace demo --dry-run=client -o yaml | kubectl apply -f -
kubectl -n demo create secret generic db-credentials --from-env-file=secrets/demo.env \
  --dry-run=client -o yaml | kubectl apply -f -
```

Verificado: aplicar sobre um namespace criado de forma imperativa funciona, com um aviso único de que a annotation `last-applied-configuration` estava faltando e está sendo adicionada. Objetos criados por `apply` desde o início nunca mostram esse aviso.

### O formato de um script de bootstrap

```bash
#!/usr/bin/env bash
set -euo pipefail

# 1. cluster
sudo snap install microk8s --classic --channel=1.35/stable
sudo microk8s status --wait-ready
sudo microk8s enable dns hostpath-storage rbac metrics-server ingress cert-manager

# 2. configuração no nível do nó (escrita de arquivos idempotente, restart só se mudou)
sudo install -D -m 0644 registry/hosts.toml \
  /var/snap/microk8s/current/args/certs.d/registry.internal:5000/hosts.toml
# ... compare antes de copiar e reinicie o MicroK8s só quando algum arquivo mudou

# 3. pré-requisitos do cluster
kubectl wait --for condition=established --timeout=120s crd/certificates.cert-manager.io
kubectl -n cert-manager rollout status deploy/cert-manager-webhook --timeout=180s
kubectl apply -k k8s/00-cluster          # namespaces, ClusterIssuers, RBAC, políticas

# 4. segredos de fora do Git
for ns in team-a team-b; do
  kubectl -n "$ns" create secret generic db-credentials \
    --from-env-file="secrets/$ns/db.env" --dry-run=client -o yaml | kubectl apply -f -
done

# 5. workloads, em ordem de dependência, esperando entre as camadas
kubectl apply -k k8s/10-shared
kubectl -n shared rollout status deploy/redis --timeout=300s
kubectl apply -k k8s/20-apps/team-a
kubectl -n team-a rollout status deploy/web --timeout=300s

# 6. smoke test
curl -fsS --retry 10 --retry-delay 3 https://api.example.com/healthz
```

Os princípios por trás dele:

- **`set -euo pipefail`**: parar na primeira falha em vez de continuar num cluster configurado pela metade.
- **Esperar pelo que o próximo passo precisa**, não um `sleep` fixo. `microk8s status --wait-ready`, `kubectl wait --for condition=established crd/...`, `kubectl rollout status`, `kubectl wait --for=condition=complete job/...`.
- **Webhooks são uma corrida clássica**: logo depois de instalar o cert-manager (ou qualquer admission webhook), criar os recursos dele falha até o Pod do webhook estar pronto. Espere o Deployment dele explicitamente.
- **Segredos vêm de fora do Git** (uma exportação do gerenciador de senhas, arquivos criptografados com SOPS, um cofre) pelo mesmo padrão de apply.
- **Restarts só quando necessário**: mudanças de arquivo no nó que exigem `snap restart microk8s` devem comparar o conteúdo antes, para que rodar de novo não reinicie o cluster à toa.

### Validando: reconstruir do zero

Idempotência se testa rodando o script duas vezes numa máquina nova: a segunda execução não pode mudar nada. Reprodutibilidade se testa destruindo tudo e rodando mais uma vez:

```bash
multipass launch 24.04 --name rebuild-test --cpus 2 --memory 8G --disk 40G
multipass transfer -r ./platform rebuild-test:
multipass exec rebuild-test -- ./platform/bootstrap.sh
multipass exec rebuild-test -- ./platform/bootstrap.sh    # segunda execução: nenhuma mudança, nenhum erro
```

Depois, as verificações que provam que funciona, não só que foi aplicado:

- `kubectl get pods -A` não mostra nada fora de `Running` ou `Completed`.
- Todo Deployment reporta `rollout status` completo.
- Os smoke tests passam: uma requisição pelo Ingress com certificado válido, um login, uma escrita e uma leitura.
- `kubectl diff -k` em todo overlay sai com `0`: o cluster bate exatamente com o Git.

O que reconstruções costumam revelar: uma imagem que só existia num registry que fazia parte do nó antigo, uma Secret que nunca foi anotada em lugar nenhum, um `kubectl edit` manual que não está no Git, um passo que depende de restos de uma execução anterior.

### Do script ao GitOps

Um script de bootstrap é o primeiro passo certo. Conforme o número de clusters ou aplicações cresce, um controller de GitOps (Argo CD, Flux) assume o passo 5: ele aplica continuamente o que está no Git, reporta desvios, e cuida da ordem com sync waves ou dependências. Os passos de nível de cluster (instalação, add-ons, arquivos do nó, o próprio controller de GitOps) continuam no script de bootstrap.

## Trade-offs

- **`create` imperativo vs declarar e aplicar.** O `create` é mais curto de digitar e falha ao rodar de novo; o padrão dry-run e apply é um pouco mais longo e torna todo passo repetível.
- **Sleeps fixos vs esperas explícitas.** Sleeps ou são curtos demais (instáveis) ou longos demais (lentos); esperas explícitas são precisas e falham com uma mensagem clara.
- **Script vs GitOps.** Um script é transparente e não tem componente extra; o GitOps adiciona um controller para rodar e dá reconciliação contínua e detecção de desvios.

## Documentation Links

- [Kubernetes docs: Declarative Management of Kubernetes Objects Using Configuration Files](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/declarative-config/): por que o apply converge.
- [kubectl wait reference](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_wait/): conditions, esperas por JSONPath, timeouts.
- [MicroK8s: Command reference](https://canonical.com/microk8s/docs/command-reference): `status --wait-ready`, `enable`.
- [Argo CD: Sync Phases and Waves](https://argo-cd.readthedocs.io/en/stable/user-guide/sync-waves/): ordem declarativa no GitOps.
