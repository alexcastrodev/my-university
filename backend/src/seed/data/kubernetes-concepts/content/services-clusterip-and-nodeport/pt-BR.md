---
version: 1.0
updatedAt: 2026-09-26
title: "Services: ClusterIP e NodePort"
summary: "Como Services dão aos Pods um endereço estável, a faixa de NodePort e como alcançá-la de fora do cluster, e quando usar um Ingress no lugar."
---
## Objective

Um Service dá a um conjunto variável de Pods um endereço estável. O campo `type` decide quem alcança esse endereço: `ClusterIP` (o padrão) só é acessível de dentro do cluster; `NodePort` abre, além disso, uma porta entre 30000 e 32767 em todos os nós, acessível de fora; `LoadBalancer` pede um IP a um load balancer externo. Num nó MicroK8s único sem provedor de nuvem, NodePort é o jeito mais simples de expor algo como um dashboard de administração, e tem limites que vale conhecer. Este conceito cobre ClusterIP e NodePort, como o tráfego realmente flui, e como alcançar um NodePort de outra máquina.

## Use Cases

- Services só internos para bancos, brokers e APIs que outros Pods chamam.
- Expor uma interface de administração (um dashboard, o Grafana, uma ferramenta interna) numa porta fixa do nó, sem Ingress.
- Escolher um número de NodePort que sobreviva à recriação do Service.
- Entender por que o `ss -ltn` no nó não mostra o NodePort, e mesmo assim ele funciona.

## Deep Dive

### ClusterIP

```yaml
apiVersion: v1
kind: Service
metadata: {name: api, namespace: team-a}
spec:
  type: ClusterIP               # padrão, pode ser omitido
  selector: {app: api}
  ports:
    - name: http
      port: 80                  # a porta do Service
      targetPort: 8080          # a porta do container (número ou nome da porta)
```

O Service recebe um IP virtual da faixa de services (`10.152.183.0/24` no MicroK8s, `10.43.0.0/16` no k3s). Nenhum processo escuta nele: o kube-proxy programa regras de iptables ou nftables em cada nó que traduzem `ClusterIP:80` para um dos IPs de Pods prontos na porta 8080. É também por isso que você não consegue dar `ping` num ClusterIP.

O `targetPort` pode referenciar a porta do container pelo nome (`targetPort: http`), o que permite mudar a porta do container sem mexer no Service.

### NodePort

```yaml
spec:
  type: NodePort
  selector: {app: dashboard}
  ports:
    - name: https
      port: 8443
      targetPort: 8443
      nodePort: 30443           # opcional; aleatório em 30000-32767 se omitido
```

Um Service NodePort é um Service ClusterIP **mais** uma porta aberta no IP de cada nó. O tráfego para `<ip-de-qualquer-nó>:30443` é encaminhado para um Pod pronto, mesmo que esse Pod rode em outro nó.

A faixa é imposta pelo API server. Verificado:

```
$ kubectl create service nodeport np --tcp=80:8080 --node-port=29999
The Service "np" is invalid: spec.ports[0].nodePort: Invalid value: 29999:
provided port is not in the valid range. The range of valid ports is 30000-32767
```

(A faixa pode ser mudada com a flag do API server `--service-node-port-range`, raramente vale a pena.)

**Fixe o `nodePort` explicitamente** para qualquer coisa que as pessoas salvem nos favoritos ou que regras de firewall referenciem. Sem isso, apagar e recriar o Service atribui uma porta aleatória nova. Mantenha também um pequeno registro de quais NodePorts você usa: dois Services não podem compartilhar um, e o segundo falha com `provided port is already allocated`.

### Alcançando um NodePort de fora

Verificado no MicroK8s a partir da máquina host:

```bash
$ kubectl get svc echo-np
NAME      TYPE       CLUSTER-IP      PORT(S)
echo-np   NodePort   10.152.183.68   80:32687/TCP

$ curl http://192.168.252.3:32687/
api
```

Use qualquer IP de nó (ou um nome DNS apontando para ele). O que pode atrapalhar:

- **Firewall do host.** `ufw` ou security groups da nuvem precisam liberar a porta. Nada no nó escuta nela no sentido usual: `ss -ltn | grep 32687` não retornou nada, porque o encaminhamento acontece em regras de pacotes do kernel, não num processo escutando. Ferramentas de firewall que só inspecionam sockets em escuta também não vão mostrá-la.
- **Endereços.** NodePorts abrem em todos os endereços do nó por padrão. Num nó com interface pública e privada, restrinja com o `--nodeport-addresses` do kube-proxy (no MicroK8s em `/var/snap/microk8s/current/args/kube-proxy`) se a interface de administração só pode ser alcançada internamente.
- **IP de origem.** Com o padrão `externalTrafficPolicy: Cluster`, o Pod vê o IP do nó como cliente, não o real. `externalTrafficPolicy: Local` preserva o IP do cliente, mas só os nós que rodam um Pod pronto respondem.
- **TLS e hostnames.** Uma aplicação atrás de um NodePort é endereçada como `https://nó:30443`. Aplicações que montam URLs absolutas (redirect URIs de OAuth, emissores de token, links em e-mails) precisam ser configuradas exatamente com essa URL externa.

### Escolhendo o tipo

| Necessidade | Tipo |
|---|---|
| Pod para Pod dentro do cluster | `ClusterIP` |
| Acesso externo rápido num nó único, interfaces de admin, laboratórios | `NodePort` |
| Muitos serviços HTTP nas portas 80/443 com hostnames e TLS | `ClusterIP` + Ingress ou Gateway |
| Um IP externo de verdade por Service | `LoadBalancer` (MetalLB em bare metal: `microk8s enable metallb`) |

No MicroK8s, o add-on de ingress ocupa as portas 80 e 443 do nó diretamente (hostPort), então serviços HTTP normalmente passam pelo Ingress, e o NodePort fica para protocolos não HTTP ou coisas que precisam ser independentes do Ingress (uma interface de administração é um bom exemplo: é por ela que você conserta um Ingress quebrado).

### Verificando um Service de ponta a ponta

```bash
kubectl -n team-a get svc api
kubectl -n team-a get endpointslices -l kubernetes.io/service-name=api   # quais IPs de Pod estão por trás
kubectl -n team-a run curl --rm -it --image=curlimages/curl:8.16.0 --restart=Never \
  -- curl -s http://api/healthz
```

Sem endpoints significa que o selector não casa com nenhum Pod **pronto**: labels erradas ou readiness probes falhando.

## Trade-offs

- **NodePort vs Ingress.** O NodePort não precisa de componente extra e funciona para qualquer protocolo TCP; dá portas altas estranhas, uma porta por serviço, e nenhum roteamento por host nem TLS centralizado.
- **nodePort fixo vs aleatório.** Portas fixas são estáveis para usuários e firewalls e exigem que você gerencie colisões; portas aleatórias não precisam de coordenação e mudam sempre que o Service é recriado.
- **`externalTrafficPolicy: Cluster` vs `Local`.** Cluster distribui o tráfego por igual e esconde o IP do cliente; Local preserva o IP do cliente e pode deixar nós sem Pods locais incapazes de responder.

## Documentation Links

- [Kubernetes docs: Service](https://kubernetes.io/docs/concepts/services-networking/service/): tipos, portas, selectors.
- [Kubernetes docs: Service type NodePort](https://kubernetes.io/docs/concepts/services-networking/service/#type-nodeport): faixa, escolha de porta, `nodeport-addresses`.
- [Kubernetes docs: Virtual IPs and Service Proxies](https://kubernetes.io/docs/reference/networking/virtual-ips/): como o kube-proxy implementa ClusterIP e NodePort.
- [Kubernetes docs: Using Source IP](https://kubernetes.io/docs/tutorials/services/source-ip/): efeitos do `externalTrafficPolicy`.
