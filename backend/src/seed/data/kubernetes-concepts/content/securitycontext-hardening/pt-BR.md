---
version: 1.0
updatedAt: 2026-09-26
title: "Hardening com securityContext"
summary: "runAsNonRoot, allowPrivilegeEscalation, remoção de capabilities, seccomp e sistema de arquivos raiz somente leitura, como verificar cada um, e o que quebra."
---
## Objective

Um container é um processo Linux com uma visão restrita do sistema, e por padrão as restrições são mais frouxas do que a maioria das aplicações precisa: ele pode rodar como root, ganhar privilégios por binários setuid, manter uma dúzia de capabilities do Linux, escrever em qualquer lugar do seu sistema de arquivos e chamar quase qualquer syscall. Os campos de `securityContext` removem cada uma dessas coisas, para que uma aplicação comprometida consiga fazer o mínimo possível. Este conceito passa pelos campos que importam (`runAsNonRoot`, `allowPrivilegeEscalation: false`, `capabilities: drop: [ALL]`, `seccompProfile`, `readOnlyRootFilesystem`), mostra como verificar que estão em vigor, e o que costuma quebrar quando você os aplica.

## Use Cases

- Cumprir o nível `restricted` de Pod Security em namespaces de aplicação.
- Limitar o estrago de uma execução remota de código numa aplicação web.
- Tornar o sistema de arquivos do container imutável para que um malware não consiga gravar arquivos.
- Rodar uma imagem de prateleira como o nginx sem root.

## Deep Dive

### A base endurecida

```yaml
spec:
  securityContext:                       # nível de Pod: vale para todos os containers
    runAsNonRoot: true
    runAsUser: 10001
    runAsGroup: 10001
    fsGroup: 10001
    seccompProfile: {type: RuntimeDefault}
  containers:
    - name: app
      image: registry.example.com/demo/web-app:1.4.2
      securityContext:                   # nível de container: sobrescreve o de Pod onde os dois existem
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop: [ALL]
      volumeMounts:
        - {name: tmp, mountPath: /tmp}   # espaço temporário gravável
  volumes:
    - name: tmp
      emptyDir: {}
  automountServiceAccountToken: false
```

O que cada campo faz:

| Campo | Efeito |
|---|---|
| `runAsNonRoot: true` | o kubelet se recusa a iniciar um container que rodaria como UID 0 |
| `runAsUser` / `runAsGroup` | a identidade numérica do processo, independente do `USER` da imagem |
| `allowPrivilegeEscalation: false` | liga o `no_new_privs`: binários setuid (`sudo`, `su`, `ping` em algumas imagens) não conseguem elevar privilégios |
| `capabilities.drop: [ALL]` | remove todas as capabilities do Linux (o conjunto padrão do runtime inclui `CHOWN`, `SETUID`, `NET_BIND_SERVICE`, `NET_RAW`...) |
| `seccompProfile: RuntimeDefault` | o filtro de syscalls do runtime bloqueia syscalls perigosas (carregar módulos do kernel, `ptrace` de outros processos, montagens diretas) |
| `readOnlyRootFilesystem: true` | o sistema de arquivos da imagem é montado somente leitura; só os volumes são graváveis |

### Verificando que está em vigor

De dentro do container, o kernel diz a verdade. Verificado no k3s com um Pod `nginx-unprivileged` endurecido:

```
$ kubectl exec nginx-unpriv -- sh -c 'id; grep -E "^(CapEff|NoNewPrivs|Seccomp):" /proc/1/status'
uid=101(nginx) gid=101(nginx) groups=101(nginx)
CapEff:	0000000000000000        # nenhuma capability
NoNewPrivs:	1                   # allowPrivilegeEscalation: false
Seccomp:	2                   # modo filtro ativo
```

E para o sistema de arquivos somente leitura (outro Pod verificado):

```
$ touch /x
touch: /x: Read-only file system
```

### O que quebra, e como corrigir

**A imagem roda como root.** Com `runAsNonRoot: true` e sem `runAsUser`, uma imagem root é recusada:

```
CreateContainerConfigError
container has runAsNonRoot and image will run as root (pod: "nonroot-on-root-image_lab(...)", container: c)
```

(verificado). Defina `runAsUser` com um UID diferente de zero se o software funciona com qualquer usuário, ou use uma imagem construída com um `USER` não root.

**O software escreve no próprio sistema de arquivos.** Verificado com a imagem padrão `nginx:1.29-alpine` forçada para o UID 101 e raiz somente leitura:

```
nginx: [emerg] mkdir() "/var/cache/nginx/client_temp" failed (30: Read-only file system)
```

O container entrou em `Error`/`CrashLoopBackOff`. Duas correções: montar um `emptyDir` em cada diretório onde o software escreve (`/var/cache/nginx`, `/var/run`, `/tmp`), ou usar uma imagem feita para isso. A `nginxinc/nginx-unprivileged` roda como UID 101, escuta na 8080 e escreve só em `/tmp`; com um `emptyDir` em `/tmp` e o securityContext endurecido completo, ela rodou e serviu a página de boas-vindas (verificado acima).

**Portas abaixo de 1024.** Sem `NET_BIND_SERVICE` (removida junto com `ALL`), um processo não root não consegue ocupar a porta 80. Escute na 8080 dentro do container e mapeie no Service (`port: 80, targetPort: 8080`). Se realmente precisar, devolva só essa capability:

```yaml
capabilities:
  drop: [ALL]
  add: [NET_BIND_SERVICE]
```

**Ferramentas que precisam de `ping` ou raw sockets** perdem `NET_RAW`. Isso é intencional para containers de aplicação; depure com `kubectl debug` e uma imagem separada.

**Volumes não graváveis pelo UID.** Use `fsGroup` (veja o conceito de permissões de volume).

### Além do básico

- **`privileged: false`** é o padrão; nunca o coloque como true em aplicações (ele desliga quase todo o isolamento).
- **`hostNetwork`, `hostPID`, `hostIPC`, `hostPath`** quebram o isolamento em relação ao nó; bloqueados pelo nível `baseline`.
- **Perfis de AppArmor/SELinux** adicionam controle de acesso obrigatório por cima (`appArmorProfile`, `seLinuxOptions`); nós Ubuntu (incluindo o MicroK8s) têm o AppArmor ligado.
- **User namespaces** (`hostUsers: false`) mapeiam o root de dentro do container para um UID sem privilégios no nó, uma mitigação forte em kernels e versões de Kubernetes recentes.
- **Imagens mínimas** (distroless, scratch) removem o shell e o gerenciador de pacotes que um atacante usaria.

## Trade-offs

- **Endurecido por padrão vs compatibilidade.** Um securityContext estrito quebra imagens que assumem root ou um sistema de arquivos gravável; cada correção (um emptyDir, outra imagem, um UID) é pequena e precisa ser feita por workload.
- **Sistema de arquivos raiz somente leitura vs conveniência.** Containers imutáveis impedem que um atacante persista arquivos e obrigam você a declarar todo caminho gravável; aplicações que escrevem caches em lugares inesperados falham na primeira execução.
- **Configurações de nível de Pod vs de container.** Campos de nível de Pod deixam os manifests curtos; configurações de container são necessárias quando sidecars têm exigências diferentes.

## Lab

Neste lab você recebe um Deployment do nginx que serve a página de boas-vindas, mas como root, com as capabilities padrão e um sistema de arquivos gravável. O seu trabalho é endurecer o container com `securityContext` e depois resolver o problema que isso causa, sem enfraquecer nenhuma das configurações. A ideia central é sentir que cada restrição de segurança tem um custo, e que a imagem oficial do nginx foi feita supondo que pode ser root e escrever em disco.

**O cenário**

Um cluster Kubernetes real (k3s, subido pelo Testcontainers) recebe o seu `web.yaml` e um Pod `client` já pronto.

- `src/main/resources/k8s/web.yaml`: o único arquivo que você edita. Tem o Deployment `web` (`nginx:1.29-alpine`, porta `http` 80, readiness probe em `/`) e o Service `web` na porta 80.
- `src/test/resources/k8s/client.yaml`: o Pod `client` (busybox) de onde o teste faz a requisição a `http://web`.
- `src/test/java/SecurityContextTest.java`: lê `/proc/1/status` dentro do container e verifica o resultado.

O teste exige que o container não consiga escrever no sistema de arquivos raiz, que o processo principal tenha `CapEff: 0000000000000000`, `NoNewPrivs: 1` e `Seccomp: 2`, que não rode como UID 0 e que `http://web` ainda devolva a página do nginx.

**O que você vai fazer, passo a passo**

1. **Rodar os testes primeiro.** O nginx serve a página, mas como root, com capabilities padrão e disco gravável, então as verificações de segurança falham.
2. **Endurecer o container (TODO-00).** Adicione o `securityContext` nos dois níveis: no do Pod, o usuário não-root e o perfil seccomp padrão do runtime, e no do container, sistema de arquivos raiz somente leitura, sem escalada de privilégios e sem nenhuma capability. Cada valor corresponde a uma linha de `/proc/1/status` que o teste lê.
3. **Fazer o nginx funcionar assim (TODO-01).** Agora ele quebra ao iniciar, e a mensagem de falha mostra as últimas linhas de log. Resolva de uma de duas formas: dar ao nginx diretórios graváveis (volumes `emptyDir` nos caminhos em que ele escreve) ou trocar por uma imagem feita para rodar sem privilégios. Lembre que um nginx sem privilégios não escuta na porta 80, então o Service precisa continuar respondendo na 80. Em nenhum caso você pode afrouxar o que fez no passo anterior.

**Como saber que terminou**

`mvn -pl kubernetes-concepts/securitycontext-hardening test` passa. Você deve conseguir explicar o que cada linha de `/proc/1/status` prova e por que o nginx precisou de ajuda para rodar sob essas restrições.

**Desafios opcionais**

- **TODO-02:** resolva o TODO-01 também do outro jeito. Se você trocou de imagem, volte para `nginx:1.29-alpine` e descubra todos os diretórios em que ele precisa escrever; se manteve a imagem oficial, experimente `nginxinc/nginx-unprivileged`. Qual solução você preferiria manter?

**Pré-requisitos:** Docker rodando localmente (os testes sobem um container `rancher/k3s` e baixam `nginx` e `busybox` dentro dele) e o artigo "securityContext Hardening".

**Como rodar:** clone o repositório e, a partir da raiz, rode `mvn -pl kubernetes-concepts/securitycontext-hardening test`. Os comentários `TODO-00` e `TODO-01` em `web.yaml` marcam o que fazer.

## Documentation Links

- [Kubernetes docs: Configure a Security Context for a Pod or Container](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/): todos os campos com exemplos.
- [Kubernetes docs: Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/): quais campos cada nível exige.
- [Kubernetes docs: Restrict a Container's Syscalls with seccomp](https://kubernetes.io/docs/tutorials/security/seccomp/): RuntimeDefault e perfis customizados.
- [Kubernetes docs: Use a User Namespace With a Pod](https://kubernetes.io/docs/tasks/configure-pod-container/user-namespaces/): `hostUsers: false`.
- [nginx-unprivileged image](https://hub.docker.com/r/nginxinc/nginx-unprivileged): nginx feito para rodar como não root.
