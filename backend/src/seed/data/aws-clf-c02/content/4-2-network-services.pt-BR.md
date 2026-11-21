---
version: 1.0
updatedAt: 2026-11-21
---
# Serviços de rede: VPC, gateways, Route 53, entrega de borda e conectividade híbrida

> Domínio do exame: **Tecnologia e serviços de nuvem (34%)**, objetivo 3.5 *Identificar os serviços de rede da AWS*.

---

## O que o exame cobra

O guia pede que você conheça os **componentes de uma VPC** (sub-redes, gateways), a **segurança da VPC** (ACLs de rede, grupos de segurança, Amazon Inspector), a **finalidade do Amazon Route 53** e as **opções de conectividade** (AWS VPN, AWS Direct Connect). A lista de redes no escopo inclui ainda API Gateway, CloudFront, Global Accelerator, PrivateLink, Transit Gateway, Site-to-Site VPN e Client VPN.

---

## Componentes básicos da Amazon VPC

Uma **VPC** é uma rede virtual logicamente isolada que você define em uma Região. Ela abrange as AZs dessa Região. Uma **sub-rede** fica inteiramente dentro de **uma AZ**.

```text
 Region
 +-- VPC 10.0.0.0/16 -------------------------------------------+
 |  AZ-a                          AZ-b                           |
 |  [Public subnet]  route 0.0.0.0/0 -> Internet gateway        |
 |     web servers, NAT gateway                                  |
 |  [Private subnet] route 0.0.0.0/0 -> NAT gateway             |
 |     app servers, databases (outbound only)                    |
 +--------------------------------------------------------------+
```

| Componente | O que faz |
|------------|-----------|
| **Sub-rede** | Um intervalo de endereços em uma AZ. Seu tipo segue o seu roteamento |
| **Tabela de rotas** | Decide para onde vai o tráfego que sai de uma sub-rede |
| **Internet gateway** | Permite que uma VPC se comunique com a internet nos dois sentidos. Escalado horizontalmente, redundante, sem restrição de largura de banda |
| **NAT gateway** | Permite que instâncias em uma sub-rede privada acessem o exterior (patches, APIs) sem que o exterior possa iniciar conexões com elas. Um NAT gateway público fica em uma sub-rede pública com um Elastic IP |
| **Elastic IP** | Um endereço IPv4 público estático. Todo endereço IPv4 público é cobrado, em uso ou ocioso |
| **Emparelhamento de VPC (VPC peering)** | Conexão privada entre duas VPCs, da mesma conta ou Região ou de outra |
| **VPC Flow Logs** | Capturam informações sobre o tráfego IP, publicadas no CloudWatch Logs, no Amazon S3 ou no Amazon Data Firehose |

**O que torna uma sub-rede pública é uma rota para um internet gateway.** Uma sub-rede privada não tem essa rota e usa um dispositivo NAT para o acesso de saída à internet. Cada Região também tem uma **VPC padrão** com uma sub-rede pública em cada AZ e um internet gateway já anexado.

---

## Grupos de segurança vs ACLs de rede (visão de rede)

| | Grupo de segurança | ACL de rede |
|---|---|---|
| Anexado a | Instância (interface de rede) | Sub-rede |
| Regras | Apenas permitir | Permitir e **negar** |
| Estado | **Com estado (stateful)**: o tráfego de retorno é permitido automaticamente | **Sem estado (stateless)**: o tráfego de retorno precisa ser permitido explicitamente |
| Avaliação | Todas as regras em conjunto | Em ordem numérica, a primeira correspondência vence |

Use um grupo de segurança para "somente o balanceador de carga pode acessar os servidores de aplicação". Use uma ACL de rede para "bloquear este intervalo de IPs para a sub-rede inteira". O Amazon Inspector, também citado neste objetivo, examina workloads em busca de vulnerabilidades e de exposição de rede não intencional (lição 2-4).

---

## Amazon Route 53

O Route 53 é um serviço de **DNS** altamente disponível e escalável, com três funções que podem ser combinadas: **registro de domínio**, **roteamento de DNS** e **verificação de integridade**. Registrar um domínio cria uma zona hospedada automaticamente. Uma **zona hospedada privada** responde a consultas de DNS apenas dentro das suas VPCs. Um **registro de alias** pode apontar o apex da zona (example.com, sem www) para um recurso da AWS, como uma distribuição do CloudFront, o que um CNAME não consegue fazer, e as consultas de alias a recursos da AWS não são cobradas.

| Política de roteamento | Use quando |
|------------------------|------------|
| Simples | Um recurso, sem lógica especial |
| Ponderada | Dividir o tráfego por porcentagem (enviar 10 por cento para uma nova versão) |
| Latência | Enviar os usuários para a Região com a menor latência para eles |
| Failover | Ativo-passivo: o primário enquanto estiver íntegro, o secundário quando a verificação de integridade falhar |
| Geolocalização | Responder pelo país ou continente do usuário (conteúdo local, restrições legais) |
| Geoproximidade | Rotear pela distância até os seus recursos, com um viés para deslocar o tráfego |
| Resposta de vários valores | Retornar vários registros íntegros de forma aleatória |
| Baseada em IP | Rotear pelo intervalo de IPs do cliente |

---

## Serviços de borda e porta de entrada

| Necessidade | Serviço |
|-------------|---------|
| Armazenar em cache conteúdo estático e dinâmico perto dos usuários no mundo todo (imagens, vídeo, páginas web) | **Amazon CloudFront** |
| Dois endereços IP anycast estáticos, tráfego TCP ou UDP pela rede global da AWS, failover Regional rápido, sem cache | **AWS Global Accelerator** |
| Distribuir o tráfego entre destinos íntegros em uma ou mais AZs | **Elastic Load Balancing** |
| Criar, publicar, proteger e monitorar APIs REST, HTTP e WebSocket na frente do Lambda ou de outros back-ends | **Amazon API Gateway** |

- O CloudFront serve conteúdo em cache a partir da borda e busca na **origem** (bucket do S3, balanceador de carga, EC2, API Gateway) quando não há o item em cache. Um bucket privado do S3 funciona como origem por meio do **controle de acesso à origem** (OAC, origin access control).
- O Global Accelerator serve para workloads que não são HTTP (jogos multijogador por UDP, IoT, VoIP) ou aplicações HTTP que precisam de IPs fixos.
- Tipos de balanceador de carga: **Application Load Balancer** (camada 7, HTTP e HTTPS, roteia por caminho ou cabeçalho), **Network Load Balancer** (camada 4, TCP e UDP, performance extrema, IP estático), **Gateway Load Balancer** (appliances virtuais de terceiros). O Classic Load Balancer é a geração anterior.

---

## Conexão entre redes

| Necessidade | Serviço |
|-------------|---------|
| Túnel criptografado de um escritório ou data center para uma VPC pela internet, configurado rapidamente | **AWS Site-to-Site VPN** (IPsec, dois túneis por conexão) |
| Usuários remotos individuais se conectando de notebooks a recursos da AWS e no local (on-premises) | **AWS Client VPN** (gerenciado, cliente baseado em OpenVPN) |
| Link privado dedicado da sua rede até a AWS que **não passa pela internet**, performance consistente para grandes transferências | **AWS Direct Connect** |
| Um hub que une muitas VPCs e redes no local (on-premises) em vez de uma malha de emparelhamentos | **AWS Transit Gateway** |
| Acessar um serviço em outra VPC ou conta (ou um serviço da AWS) de forma privada, como se estivesse dentro da sua VPC | **AWS PrivateLink** |

- O Site-to-Site VPN precisa de um **gateway do cliente** (customer gateway, o seu dispositivo) e de um virtual private gateway ou transit gateway do lado da AWS.
- O Direct Connect funciona por um link de fibra até um local do Direct Connect. As conexões dedicadas atualmente são de 1, 10, 100 ou 400 Gbps, e os parceiros oferecem conexões hospedadas a partir de 50 Mbps (em 21/11/2026). Um **Direct Connect gateway** permite que uma conexão alcance VPCs em muitas Regiões.
- **O Direct Connect não é criptografado por padrão.** Execute um Site-to-Site VPN sobre ele para ter IPsec, ou use MACsec em conexões dedicadas compatíveis.

> Não citado no guia do exame: **VPC endpoints**. Um endpoint de gateway permite que uma sub-rede privada acesse o S3 ou o DynamoDB sem um internet gateway ou dispositivo NAT; os endpoints de interface são baseados no PrivateLink.

> Material de estudo antigo diz que as velocidades do Direct Connect vão até 10 ou 100 Gbps e que os links hospedados vão até 500 Mbps. O FAQ atual do Direct Connect lista conexões dedicadas de até 400 Gbps e conexões hospedadas de até 25 Gbps.

---

## Atenção

- **Uma VPC pertence a uma Região e uma sub-rede a uma AZ.** "Abranger duas Regiões" é falso para uma VPC.
- **Internet gateway vs NAT gateway: quem inicia a conexão.** Entrada e saída para recursos públicos indica internet gateway; somente saída a partir de uma sub-rede privada indica NAT gateway.
- **"Negar" ou "sub-rede inteira" indica ACL de rede.** Grupos de segurança não têm regras de negação.
- **VPN vs Direct Connect: o transporte decide, não a palavra "seguro".** A VPN é criptografada e trafega pela internet; o Direct Connect é privado e não passa pela internet, mas precisa de VPN ou MACsec para criptografia.
- **O CloudFront faz cache de conteúdo, o Global Accelerator não.** IPs estáticos e UDP indicam Global Accelerator.
- **O Client VPN é para pessoas, o Site-to-Site VPN é para redes.**
- **Muitas VPCs mais data centers em um único hub indica Transit Gateway,** não dezenas de conexões de emparelhamento.
- **O Route 53 é DNS, não um balanceador de carga.** Ele responde com um endereço de acordo com políticas e verificações de integridade; o ELB distribui as conexões de fato.

## Verificação rápida

1. O que torna uma sub-rede pública? **Uma rota para um internet gateway.**
2. Servidores privados devem baixar patches, mas não aceitar conexões de entrada da internet. **NAT gateway.**
3. Enviar 5 por cento dos usuários para uma nova versão da aplicação por DNS. **Roteamento ponderado do Route 53.**
4. Um jogo UDP precisa de dois IPs fixos e failover rápido entre Regiões. **AWS Global Accelerator.**
5. Um link dedicado que não passa pela internet também precisa ser criptografado. **Direct Connect com um Site-to-Site VPN sobre ele (ou MACsec).**

## Documentação oficial

- [What is Amazon VPC](https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html)
- [Subnets for your VPC](https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html)
- [NAT gateways](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html)
- [Compare security groups and network ACLs](https://docs.aws.amazon.com/vpc/latest/userguide/infrastructure-security.html)
- [Route 53 routing policies](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy.html)
- [Global Accelerator FAQs](https://aws.amazon.com/global-accelerator/faqs/)
- [What is AWS Direct Connect](https://docs.aws.amazon.com/directconnect/latest/UserGuide/Welcome.html)
- [Direct Connect encryption in transit](https://docs.aws.amazon.com/directconnect/latest/UserGuide/encryption-in-transit.html)
