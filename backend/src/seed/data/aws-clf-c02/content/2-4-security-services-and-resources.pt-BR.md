---
version: 1.0
updatedAt: 2026-11-21
---
# Componentes de segurança: filtros de rede, WAF, Shield, serviços de detecção e onde aprender mais

> Domínio do exame: **Segurança e Conformidade (30%)**, objetivo 2.4 *Identificar componentes e recursos de segurança*.

---

## Grupos de segurança vs ACLs de rede

Ambos filtram o tráfego em uma VPC, em pontos diferentes e com regras diferentes.

| | **Grupo de segurança** | **ACL de rede** |
|---|---|---|
| Aplica-se a | Um recurso (instância EC2, instância de banco de dados RDS, balanceador de carga e outros) | Uma **sub-rede** (todos os recursos nela) |
| Regras | **Somente permitir** | **Permitir e negar** |
| Avaliação | Todas as regras em conjunto | Em ordem crescente de **número da regra**, a primeira correspondência vence |
| Tráfego de retorno | **Permitido automaticamente (stateful)** | Deve ser **permitido explicitamente (stateless)** |
| Função | Controle principal | Controle secundário e abrangente, por exemplo para negar uma origem específica |

```text
 Internet --> route to subnet --> [ Network ACL: may this enter the subnet? ]
                                   --> [ Security group: may this reach the instance? ] --> instance
```

- Cada sub-rede tem exatamente **uma** ACL de rede (a padrão, se você não escolher); uma ACL de rede pode atender várias sub-redes.
- Toda ACL de rede termina com uma regra `*` não removível que **nega tudo o que nenhuma regra numerada correspondeu**.
- Nenhum dos dois tem cobrança extra. Para ver o tráfego que chega aos seus recursos, use o **VPC Flow Logs**.

"Bloquear um endereço IP para uma sub-rede inteira" é uma regra de negação da ACL de rede: um grupo de segurança não tem regra de negação. O AWS Network Firewall também filtra o tráfego da VPC, mas **não está no escopo deste exame**.

---

## Proteção de borda: AWS WAF, AWS Shield, AWS Firewall Manager

| Ameaça ou necessidade | Serviço |
|-----------------------|---------|
| Exploits web em requisições HTTP(S): **injeção de SQL**, IPs de origem maliciosos, query strings suspeitas | **AWS WAF** |
| **DDoS** nas camadas de rede e de transporte (3 e 4), para todos, sem cobrança | **AWS Shield Standard** (automático) |
| DDoS na camada de aplicação, especialistas de resposta, **proteção de custos** | **AWS Shield Advanced** (assinatura paga) |
| As mesmas políticas de WAF, Shield Advanced, grupo de segurança e ACL de rede em **várias contas**, incluindo as novas | **AWS Firewall Manager** |

O **AWS WAF** inspeciona requisições web para distribuições do CloudFront, APIs REST do API Gateway, Application Load Balancers, AppSync, pools de usuários do Cognito, App Runner e outras portas de entrada, e responde com o conteúdo, um HTTP 403 ou uma resposta personalizada. Ele atua na camada 7, onde os grupos de segurança não conseguem olhar.

O **AWS Shield Standard** vem ativado para **todos os clientes da AWS sem cobrança adicional**. Ele defende contra os ataques DDoS mais comuns das camadas de rede e de transporte; as zonas hospedadas do Route 53, o CloudFront e o Global Accelerator recebem proteção abrangente contra ataques conhecidos das camadas 3 e 4.

O **AWS Shield Advanced** protege apenas os recursos que você **adiciona** a ele: distribuições do CloudFront, zonas hospedadas do Route 53, aceleradores do Global Accelerator, endereços IP elásticos (e as instâncias EC2 ou Network Load Balancers por trás deles), Application Load Balancers e Classic Load Balancers. Ele acrescenta:

- mitigação automática de DDoS na **camada de aplicação (camada 7)**, usando o AWS WAF (as tarifas do WAF para os recursos protegidos estão incluídas);
- detecção baseada em integridade e maior visibilidade dos ataques;
- acesso à **Shield Response Team (SRT)**, que exige **um plano pago do AWS Support**, além de engajamento proativo;
- **proteção de custos**: créditos de serviço para cobranças de escalabilidade causadas por um ataque DDoS.

Ele é cobrado como uma assinatura mensal com compromisso de um ano, mais tarifas de uso de transferência de dados de saída.

O **AWS Firewall Manager** funciona com o AWS Organizations para aplicar esses conjuntos de regras de forma centralizada e, automaticamente, a novas contas e recursos. Você continua pagando pelos serviços subjacentes que ele configura.

> Material de estudo antigo diz que a DDoS Response Team (DRT) ajuda durante os ataques; a documentação oficial atual diz Shield Response Team (SRT). Alguns livros também dizem que o Shield cobre a camada 7 sem custo extra; a mitigação de DDoS na camada 7 é um recurso do Shield Advanced.

---

## A escada de detecção: escolha o serviço pelo verbo

| O enunciado diz | Serviço | O que usa ou cobre |
|-----------------|---------|--------------------|
| **Detectar ameaças** continuamente (mineração de criptomoedas, chamadas de IPs maliciosos) | **Amazon GuardDuty** | Inteligência de ameaças e ML sobre eventos de gerenciamento do CloudTrail, logs de fluxo da VPC e logs de DNS, mais planos de proteção opcionais (S3, EKS, RDS, Lambda, malware) |
| **Encontrar vulnerabilidades de software** e exposição de rede não intencional | **Amazon Inspector** | Examina continuamente **instâncias EC2, imagens de contêiner no Amazon ECR e funções Lambda**; examina de novo quando surge um novo CVE |
| **Descobrir dados sensíveis** (PII, dados financeiros, credenciais) | **Amazon Macie** | Buckets do **Amazon S3**; também sinaliza buckets públicos ou compartilhados |
| **Investigar a causa raiz** de um achado | **Amazon Detective** | Grafo de comportamento construído a partir do CloudTrail, dos logs de fluxo da VPC e dos achados do GuardDuty, com até um ano de histórico |
| **Uma visão única** dos achados mais **verificações automatizadas em relação a padrões** | **AWS Security Hub** | Agrega achados do GuardDuty, Inspector, Macie e de parceiros; verifica em relação ao AWS Foundational Security Best Practices, CIS, PCI DSS e NIST |
| **Quem** chamou uma API | **AWS CloudTrail** | Lição 2.2 |
| **Como era um recurso**, ele está em conformidade com as minhas regras | **AWS Config** | Lição 2.2 |
| **Verificações de melhores práticas** em toda a conta, incluindo segurança | **AWS Trusted Advisor** | Veja abaixo |

Os achados do GuardDuty vão para o Amazon EventBridge, então você pode acionar respostas automáticas. O GuardDuty e o Macie oferecem, cada um, um período de teste gratuito de 30 dias.

**AWS Security Hub: uma observação.** A AWS dividiu o serviço. O que os livros de estudo descrevem (agregação de achados e verificações automatizadas em relação a padrões) agora se chama **AWS Security Hub CSPM**, e um **AWS Security Hub** mais novo correlaciona esses achados com outros serviços em exposições. O guia do exame diz "AWS Security Hub": responda com ele para "visão central dos achados e verificações automatizadas de conformidade". A maioria das verificações dele exige o AWS Config habilitado.

**Trusted Advisor para segurança.** As verificações do Trusted Advisor cobrem otimização de custos, performance, **segurança**, tolerância a falhas, limites de serviço e excelência operacional. Um conjunto básico de verificações de segurança está disponível em todos os planos, incluindo o Basic: **permissões de buckets do S3, MFA na conta-raiz, grupos de segurança com portas específicas sem restrição, snapshots públicos do EBS e do RDS**. O conjunto completo de verificações e a API vêm com um plano pago superior do AWS Support (módulo 5). O Trusted Advisor **recomenda**; a correção e a remediação ficam com as regras do AWS Config ou com as automações do Security Hub.

---

## Outros serviços de segurança que o guia lista

| Necessidade | Serviço |
|-------------|---------|
| **Certificados SSL/TLS** públicos e privados que se renovam automaticamente no CloudFront, em balanceadores de carga e em outros serviços integrados | **AWS Certificate Manager (ACM)**: sem custo extra para certificados públicos gerenciados pelo ACM; os certificados são regionais e, para o **CloudFront**, devem estar em **Leste dos EUA (N. da Virgínia)** |
| **Microsoft Active Directory** na AWS | **AWS Directory Service**: AWS Managed Microsoft AD; **AD Connector** (um proxy para o seu AD no local); Simple AD (baseado no Samba 4) |
| **Compartilhar recursos** como sub-redes da VPC com outras contas, OUs ou toda a organização | **AWS Resource Access Manager (RAM)**, sem cobrança adicional |
| Hardware de chaves de locatário único, chaves gerenciadas, segredos | CloudHSM, KMS, Secrets Manager (lições 2.2 e 2.3) |

---

## Onde ficam as informações e os produtos de segurança

- **AWS Cloud Security** (aws.amazon.com/security): o hub que reúne links para serviços de segurança, conformidade, recursos de aprendizado e relato de vulnerabilidades. É a correspondência mais próxima do "AWS Security Center" do guia.
- **AWS Security Blog** (aws.amazon.com/blogs/security): anúncios, tutoriais e melhores práticas.
- **Cloud Security Learning Resources**: documentação, treinamento, vídeos e whitepapers.
- **AWS Knowledge Center**: respostas a perguntas comuns, agora no AWS re:Post.
- **AWS Marketplace**: **software de segurança de terceiros** (identidade, proteção de endpoints, SIEM, firewalls, serviços gerenciados de segurança) para encontrar, testar, comprar e implantar.

---

## Atenção

- **Grupo de segurança = somente permitir, stateful. ACL de rede = permitir e negar, stateless, numerada.** Regra: "negar um IP" ou "tráfego de retorno bloqueado" aponta para a ACL de rede.
- **O tráfego de entrada encontra a ACL de rede antes do grupo de segurança.** Regra: primeiro a sub-rede, depois o recurso.
- **Grupos de segurança não são exclusivos do EC2.** Regra: instâncias RDS e balanceadores de carga também os usam.
- **WAF vs Shield.** Regra: injeção de SQL e outros exploits web são WAF; inundações de tráfego são Shield.
- **O Shield Standard é gratuito, mas só cobre as camadas 3 e 4.** Regra: mitigação de DDoS na camada 7, SRT e proteção de custos significam Shield Advanced.
- **GuardDuty vs Inspector.** Regra: o GuardDuty enxerga ameaças ativas, o Inspector encontra vulnerabilidades antes que alguém as use.
- **O Macie é S3 e dados sensíveis.** Regra: o GuardDuty e o Inspector não procuram PII.
- **O Detective investiga, o Security Hub agrega.** Regra: "causa raiz" é Detective, "painel único" é Security Hub.
- **O Trusted Advisor aconselha, não remedia.**
- **O ACM para o CloudFront fica em Leste dos EUA (N. da Virgínia).**

---

## Verificação rápida

1. Bots enviam fragmentos de SQL para uma página de login atrás de um Application Load Balancer. **AWS WAF.**
2. Qual proteção contra DDoS toda conta tem sem fazer nada? **AWS Shield Standard (camadas 3 e 4).**
3. Qual serviço sinaliza números de passaporte armazenados no S3? **Amazon Macie.**
4. Um achado precisa de uma linha do tempo da atividade do perfil (role) nos últimos meses. **Amazon Detective.**
5. As mesmas regras de WAF precisam chegar a 40 contas, incluindo as novas. **AWS Firewall Manager.**

---

## Documentação oficial

- [Compare security groups and network ACLs](https://docs.aws.amazon.com/vpc/latest/userguide/infrastructure-security.html)
- [What is AWS WAF](https://docs.aws.amazon.com/waf/latest/developerguide/waf-chapter.html)
- [AWS Shield Advanced capabilities](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-advanced-summary-capabilities.html)
- [AWS Firewall Manager](https://docs.aws.amazon.com/waf/latest/developerguide/fms-chapter.html)
- [What is Amazon GuardDuty](https://docs.aws.amazon.com/guardduty/latest/ug/what-is-guardduty.html)
- [What is Amazon Inspector](https://docs.aws.amazon.com/inspector/latest/user/what-is-inspector.html)
- [Security Hub and Security Hub CSPM](https://docs.aws.amazon.com/securityhub/latest/userguide/what-are-securityhub-services.html)
- [Trusted Advisor check reference](https://docs.aws.amazon.com/awssupport/latest/user/trusted-advisor-check-reference.html)
