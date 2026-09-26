---
version: 1.0
updatedAt: 2026-09-26
title: "kubectl exec, debug e port-forward"
summary: "Rodar comandos dentro de containers, containers efêmeros de debug para imagens sem shell, e túneis de port-forward com os seus limites."
---
## Objective

Dois comandos do kubectl dão acesso direto ao que roda dentro do cluster sem expor nada publicamente: `kubectl exec` roda um comando dentro de um container em execução, e `kubectl port-forward` cria um túnel de uma porta local até um Pod ou Service através do API server. Um terceiro, `kubectl debug`, anexa um container temporário de ferramentas quando a imagem não tem shell nenhum. Este conceito cobre os três, as formas que você vai usar de fato, e os seus limites (port-forward não é balanceamento de carga, exec precisa de binários na imagem, e tudo isso exige permissões de RBAC que vale restringir).

## Use Cases

- Conferir variáveis de ambiente, arquivos montados e DNS de dentro de um Pod.
- Abrir uma interface de administração interna ou a porta de um banco no seu laptop sem um Service do tipo NodePort.
- Depurar uma imagem mínima ou distroless que não tem `sh`.
- Rodar um comando pontual (uma verificação de migração, uma limpeza de cache) no contexto da aplicação.

## Deep Dive

### kubectl exec

```bash
kubectl -n team-a exec web-6b48bf5ccc-rppzw -- env            # um comando
kubectl -n team-a exec -it web-6b48bf5ccc-rppzw -- sh         # shell interativo
kubectl -n team-a exec -it deploy/web -- sh                   # qualquer Pod do Deployment
kubectl -n team-a exec -it web-xyz -c sidecar -- sh           # um container específico
```

- `--` separa as flags do kubectl do comando.
- `-i` passa o stdin, `-t` aloca um TTY. Use `-it` para shells, e **nenhum dos dois** para saída binária que você redireciona (`kubectl exec ... -- tar czf - /data > data.tgz`): um TTY reescreve quebras de linha e corrompe o arquivo.
- `deploy/web` escolhe um Pod do Deployment; para uma réplica específica, use o nome do Pod.
- O comando roda como o usuário do container, com o sistema de arquivos, o ambiente e a rede dele. É o jeito mais fiel de testar "a aplicação alcança X": `exec ... -- wget -qO- -T 3 http://api.team-b/healthz`.

O comando precisa existir na imagem. Verificado:

```
$ kubectl exec deploy/web -- bash
error: ... exec: "bash": executable file not found in $PATH
```

Imagens Alpine e BusyBox têm `sh` mas não `bash`; imagens distroless e scratch não têm nenhum dos dois.

### kubectl debug: uma caixa de ferramentas ao lado do container

Para imagens sem shell, adicione um **container efêmero** com as ferramentas de que você precisa, compartilhando o namespace de processos do container alvo:

```bash
kubectl -n team-a debug -it web-xyz --image=busybox:1.37 --target=nginx
```

Verificado no k3s: dentro do container de debug, o `ps` mostrou os processos do alvo (`nginx: master process`, processos worker), e o sistema de arquivos do alvo ficou acessível por `/proc/1/root` (`ls /proc/1/root/etc/nginx` listou `conf.d`, `fastcgi.conf`...). O container efêmero fica no spec do Pod até o Pod ser apagado; ele não pode ser removido nem reiniciado.

Outras formas:

```bash
kubectl debug web-xyz -it --copy-to=web-debug --container=app -- sh   # cópia do Pod com um shell como comando
kubectl debug node/node1 -it --image=busybox:1.37                     # um Pod no nó com o sistema de arquivos do host em /host
```

O `kubectl debug` funciona em Pods e nós, não em Deployments (verificado: `"apps/v1, Kind=Deployment" not supported by debug`).

### kubectl port-forward

```bash
kubectl -n team-a port-forward pod/web-xyz 8080:80           # 8080 local -> porta 80 do Pod
kubectl -n team-a port-forward svc/web 8080:80                # via um Service
kubectl -n monitoring port-forward svc/grafana 3000:80 &      # em background
curl http://localhost:8080/
```

Verificado: `port-forward svc/web 18080:80` devolveu a página de boas-vindas do nginx em `localhost:18080`.

Como funciona, e o que decorre disso:

- A conexão vai do kubectl pelo **API server** e pelo kubelet até o Pod. Nenhuma porta de Service, NodePort ou Ingress é necessária, e nada fica exposto para mais ninguém.
- `svc/web` **não** faz balanceamento. O kubectl resolve o Service para **um** Pod quando o comando começa e manda tudo para lá. Se esse Pod morre, o túnel cai e precisa ser reiniciado.
- Por padrão ele escuta só em `127.0.0.1`. `--address 0.0.0.0` o expõe na sua rede, o que raramente é boa ideia.
- É uma ferramenta de depuração: túneis longos caem em timeouts de inatividade e restarts do API server. Para acesso permanente, use um Service e um Ingress com autenticação.

Usos típicos: um cliente de banco contra um Pod de banco, um endpoint de métricas ou de administração não exposto, uma interface web que só operadores devem alcançar.

### Quem pode fazer isso

`exec`, `port-forward` e `debug` são poderosos: exec dá um shell com as credenciais da aplicação, e port-forward alcança qualquer porta de Pod passando por cima da autenticação do Ingress. Em termos de RBAC, são os subresources `pods/exec`, `pods/portforward` e `pods/ephemeralcontainers`. Conceda-os de forma deliberada, não por um papel genérico `edit`, quando há produção envolvida. Note que NetworkPolicies não se aplicam ao tráfego de port-forward (ele entra pelo kubelet, não pela rede de Pods).

## Trade-offs

- **exec vs debug.** O exec é simples e precisa de ferramentas na imagem; o debug funciona com qualquer imagem e deixa um container efêmero no Pod até ele ser recriado.
- **port-forward vs um Service.** O port-forward é privado e temporário, sem mudar manifests; um Service é estável, compartilhável e precisa do seu próprio controle de acesso.
- **Imagens mínimas vs depurabilidade.** Imagens distroless reduzem a superfície de ataque e removem o shell que você usaria para depurar; o `kubectl debug` é a resposta que mantém as duas coisas.

## Documentation Links

- [Kubernetes docs: Get a Shell to a Running Container](https://kubernetes.io/docs/tasks/debug/debug-application/get-shell-running-container/): uso do exec.
- [Kubernetes docs: Debug Running Pods (ephemeral containers)](https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/#ephemeral-container): `kubectl debug`.
- [Kubernetes docs: Use Port Forwarding to Access Applications in a Cluster](https://kubernetes.io/docs/tasks/access-application-cluster/port-forward-access-application-cluster/): comportamento do port-forward.
- [Kubernetes docs: Ephemeral Containers](https://kubernetes.io/docs/concepts/workloads/pods/ephemeral-containers/): limitações.
