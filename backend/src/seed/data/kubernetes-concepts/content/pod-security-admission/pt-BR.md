---
version: 1.0
updatedAt: 2026-09-26
title: "Pod Security Standards e Admission"
summary: "Os níveis privileged, baseline e restricted, os modos enforce, warn e audit, Deployments aceitos enquanto os seus Pods são rejeitados, e uma adoção segura."
---
## Objective

Os Pod Security Standards definem três perfis de segurança para Pods: **privileged** (sem restrições), **baseline** (bloqueia escalonamentos de privilégio conhecidos, como namespaces do host, containers privilegiados e hostPath) e **restricted** (a boa prática atual de hardening: não root, sem escalonamento de privilégio, todas as capabilities removidas, um perfil de seccomp). O **Pod Security Admission**, embutido no API server, os aplica por namespace através de labels. Ele substituiu a PodSecurityPolicy, removida no Kubernetes 1.25. Este conceito cobre os três níveis, os três modos (`enforce`, `warn`, `audit`), como fica uma rejeição, a surpresa dos Deployments aceitos enquanto os seus Pods não são, e um caminho seguro de adoção.

## Use Cases

- Impedir que alguém rode containers privilegiados ou monte o sistema de arquivos do nó em namespaces de aplicação.
- Exigir Pods não root e endurecidos em namespaces de produção.
- Descobrir quais workloads existentes quebrariam antes de aplicar um nível mais estrito.
- Deixar os poucos componentes de sistema que precisam de privilégios continuarem funcionando.

## Deep Dive

### Níveis e modos

Labels no Namespace escolhem um nível por modo:

```bash
kubectl label namespace team-a \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/enforce-version=latest \
  pod-security.kubernetes.io/warn=restricted \
  pod-security.kubernetes.io/audit=restricted
```

| Modo | Efeito num Pod que viola |
|---|---|
| `enforce` | rejeitado pelo API server |
| `warn` | aceito, com um aviso devolvido ao cliente (o `kubectl` o imprime) |
| `audit` | aceito, violação registrada no audit log do API server |

O `-version` fixa as regras numa versão do Kubernetes (`v1.35`) ou em `latest`. Fixar evita surpresas quando uma atualização aperta um nível.

### Como fica uma rejeição

Verificado no k3s v1.36 num namespace com `enforce=restricted`:

```
$ kubectl -n psa run naive --image=nginx:1.29-alpine
Error from server (Forbidden): pods "naive" is forbidden: violates PodSecurity "restricted:latest":
allowPrivilegeEscalation != false (container "naive" must set securityContext.allowPrivilegeEscalation=false),
unrestricted capabilities (container "naive" must set securityContext.capabilities.drop=["ALL"]),
runAsNonRoot != true (pod or container "naive" must set securityContext.runAsNonRoot=true),
seccompProfile (pod or container "naive" must set securityContext.seccompProfile.type to "RuntimeDefault" or "Localhost")
```

A mensagem é uma lista de verificação. Um Pod que a satisfaz:

```yaml
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 10001
    seccompProfile: {type: RuntimeDefault}
  containers:
    - name: app
      image: registry.example.com/demo/web-app:1.4.2
      securityContext:
        allowPrivilegeEscalation: false
        capabilities: {drop: [ALL]}
```

Verificado: o Pod equivalente (com `busybox`) foi admitido e rodou como UID 10001.

### A armadilha do Deployment

O admission verifica **Pods**, não os seus controllers. Aplicar um Deployment num namespace com enforce funciona, só com um aviso:

```
$ kubectl -n psa create deployment d --image=nginx:1.29-alpine
Warning: would violate PodSecurity "restricted:latest": allowPrivilegeEscalation != false ...
deployment.apps/d created

$ kubectl -n psa get deploy d
NAME   READY   UP-TO-DATE   AVAILABLE
d      0/1     0            0
```

O ReplicaSet não consegue criar nenhum Pod, e o motivo só aparece nos eventos dele:

```
Error creating: pods "d-58d65dcd6-6x5dp" is forbidden: violates PodSecurity "restricted:latest": ...
```

Um pipeline que só confere o exit code do `kubectl apply` reporta sucesso. Mais um motivo para rodar sempre `kubectl rollout status` depois de aplicar.

### warn e audit primeiro

Aplicar enforce direto num namespace com workloads rodando é arriscado. O caminho seguro:

1. Coloque labels de `warn` e `audit` para o nível desejado; mantenha o `enforce` no nível atual. Verificado: num namespace com `enforce=baseline, warn=restricted`, criar um Pod fora do padrão imprimiu `Warning: would violate PodSecurity "restricted:latest"` e mesmo assim o criou.
2. Confira os workloads existentes sem mudar nada:

```bash
kubectl label --dry-run=server --overwrite namespace team-a \
  pod-security.kubernetes.io/enforce=restricted
```

Verificado no k3s contra um namespace cheio de Pods de teste:

```
Warning: existing pods in namespace "lab" violate the new PodSecurity enforce level "restricted:latest"
Warning: badimg (and 18 other pods): allowPrivilegeEscalation != false, unrestricted capabilities, runAsNonRoot != true, seccompProfile
Warning: nonroot-on-root-image: allowPrivilegeEscalation != false, unrestricted capabilities, seccompProfile
namespace/lab labeled (server dry run)
```

Nada foi alterado; os avisos são a lista de tarefas.

3. Corrija os manifests (securityContext, imagens não root), reimplante, repita o dry run até ficar limpo.
4. Troque o `enforce`. Pods existentes não sofrem eviction; o nível vale quando Pods são criados ou recriados.

### Qual nível onde

- **`restricted`**: namespaces de aplicação. A maioria das aplicações stateless se adequa com um bloco de securityContext e uma imagem não root.
- **`baseline`**: namespaces com software que precisa de algum comportamento de root (imagens que fazem `chown` na inicialização, alguns bancos de dados); ainda bloqueia as coisas perigosas.
- **`privileged`**: namespaces de sistema para CNI, drivers de storage, agentes de nó (coletores de logs e métricas que leem caminhos do host), ingress controllers que usam `hostPort`.

Padrões e exceções para o cluster todo (namespaces, usuários, runtime classes) podem ser definidos num arquivo `AdmissionConfiguration` passado ao API server. No MicroK8s esse arquivo já existe em `/var/snap/microk8s/current/args/admission-control-config-file.yaml` (verificado na 1.35: ele só configura o plugin `EventRateLimit`); adicione uma entrada do plugin `PodSecurity` ali para definir padrões do cluster. Os labels dos namespaces continuam sobrescrevendo o padrão por namespace.

### Além do Pod Security Admission

O PSA cobre só o spec do Pod, com níveis fixos. Engines de política como **Kyverno** ou **OPA Gatekeeper** (ou a `ValidatingAdmissionPolicy` embutida, com expressões CEL) adicionam regras próprias: labels obrigatórios, registries permitidos, limits de recursos obrigatórios, `items` em fontes de secret projetadas.

## Trade-offs

- **`restricted` vs `baseline`.** O restricted bloqueia mais caminhos de ataque e exige que toda imagem rode como não root; o baseline é compatível com quase tudo e continua permitindo containers root.
- **Aplicar na hora vs avisar primeiro.** Aplicar de uma vez protege imediatamente e pode quebrar o próximo deploy de um workload existente; warn e audit primeiro dão uma lista para corrigir sem downtime.
- **PSA vs uma engine de políticas.** O PSA é embutido, rápido e sem manutenção, com regras fixas; Kyverno ou Gatekeeper são flexíveis e são mais um componente crítico no caminho do admission.

## Documentation Links

- [Kubernetes docs: Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/): controles exatos de cada nível.
- [Kubernetes docs: Pod Security Admission](https://kubernetes.io/docs/concepts/security/pod-security-admission/): modos, labels, exceções.
- [Kubernetes docs: Enforce Pod Security Standards with Namespace Labels](https://kubernetes.io/docs/tasks/configure-pod-container/enforce-standards-namespace-labels/): passo a passo, incluindo o dry run.
- [Kubernetes docs: Migrate from PodSecurityPolicy](https://kubernetes.io/docs/tasks/configure-pod-container/migrate-from-psp/): para clusters e guias antigos.
