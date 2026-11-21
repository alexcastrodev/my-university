---
version: 1.0
updatedAt: 2026-11-21
---
# Princípios de design: pilares do Well-Architected, elasticidade e modelos de serviço

> Domínio do exame: **Conceitos de nuvem (24%)**, objetivo 1.2 *Identificar os princípios de design da Nuvem AWS*.

---

## O AWS Well-Architected Framework

O Framework ajuda você a entender os prós e os contras das decisões que toma ao construir na AWS e oferece uma forma consistente de medir uma arquitetura em relação às melhores práticas. Uma revisão Well-Architected é "uma conversa construtiva, não uma auditoria".

O guia do exame cita **seis pilares** (ele nunca imprime a palavra "seis", imprime seis nomes):

| Pilar | Intenção | Uma pista típica no cenário |
|-------|----------|-----------------------------|
| **Excelência operacional** | Apoiar o desenvolvimento e a execução de workloads com eficácia, obter visibilidade das operações e melhorar continuamente processos e procedimentos | Infraestrutura e operações definidas como código, mudanças pequenas e frequentes, runbooks, aprendizado com incidentes |
| **Segurança** | Proteger dados, sistemas e ativos com uma abordagem em camadas, partindo do modelo de responsabilidade compartilhada | Identidade, proteção de dados, detecção, resposta a incidentes |
| **Confiabilidade** | Um workload executa sua função pretendida de forma correta e consistente quando esperado, ao longo de todo o seu ciclo de vida. A resiliência (recuperar-se de uma interrupção) é o foco principal | Failover automático, backups, isolamento de falhas, testes de recuperação |
| **Eficiência de performance** | Usar recursos de computação com eficiência para atender aos requisitos e manter essa eficiência conforme a demanda e a tecnologia evoluem | Escolher o tipo de computação certo, cache perto dos usuários, reavaliar escolhas quando surgem novas ofertas |
| **Otimização de custos** | Entregar valor ao negócio ao menor preço apropriado, sem deixar de atender às necessidades funcionais, de performance, de confiabilidade, de segurança e de sustentabilidade | Gestão financeira da nuvem, visibilidade do uso, recursos adequados, otimização contínua |
| **Sustentabilidade** | Reduzir o impacto ambiental da execução de workloads: medi-lo, provisionar apenas o necessário, melhorar a eficiência, otimizar dados e processamento | Maior utilização, nenhuma capacidade ociosa, hardware eficiente e serviços gerenciados |

```text
 Well-Architected Framework (one document, current structure)
 |-- Cloud Foundations  : account and organization level decisions
 `-- Cloud Workloads    : the six pillars, each split into areas and capabilities
```

Fatos que vale guardar:

- **Seis pilares**: a Sustentabilidade foi adicionada em 2 de dezembro de 2021. "Cinco pilares" está desatualizado.
- **Não são pilares**: resiliência (é o foco da Confiabilidade), elasticidade, escalabilidade, sistemas distribuídos, consistência de dados.
- **Framework vs Tool**: o Framework é a orientação. O **AWS Well-Architected Tool** é o serviço no console em que você responde a perguntas sobre um workload, recebe recomendações e acompanha melhorias. Está disponível sem custo no console.
- **Trade-offs**: você equilibra os pilares conforme o contexto do negócio. Um ambiente de desenvolvimento de curta duração pode favorecer custo e sustentabilidade em vez de confiabilidade. Um sistema de missão crítica pode aceitar mais custo em troca de confiabilidade. Uma loja online sabe que a performance afeta a receita. **Segurança e excelência operacional geralmente não são sacrificadas** em favor dos outros pilares.

> Material de estudo antigo diz que o Framework tem "princípios de design" por pilar (por exemplo, "executar operações como código" ou "parar de adivinhar a capacidade") e uma lista de seis princípios gerais de design. A AWS reestruturou o Framework em 16/11/2026: os whitepapers por pilar foram unificados, cada pilar agora é organizado em áreas e capacidades, e as páginas clássicas de "Princípios de design" foram removidas (permanecem apenas em versões históricas). Os nomes dos seis pilares não mudaram. Trate as listas antigas como formulação histórica: aprenda a intenção de cada pilar e espere questões sobre a ideia, não sobre uma frase exata de princípio.

---

## Escalabilidade e elasticidade

| Termo | Ideia oficial | Dica de memória |
|-------|---------------|-----------------|
| **Escalabilidade** | Uma medida da capacidade de um sistema de **crescer** para acomodar mais demanda | Crescer |
| **Elasticidade** | Adquirir recursos conforme necessário **e liberá-los quando não forem mais necessários**, o que na nuvem pode ser feito automaticamente | Crescer **e** encolher |

- O **escalonamento horizontal** adiciona mais computadores (mais instâncias). O **escalonamento vertical** adiciona recursos a um único computador (um tipo de instância maior). Sistemas escalados horizontalmente podem superar os escalados verticalmente ao distribuir o trabalho em paralelo.
- O **Amazon EC2 Auto Scaling** mantém um grupo entre um tamanho mínimo e um máximo, inicia ou encerra instâncias com políticas de escalabilidade, substitui instâncias com problemas e pode equilibrar instâncias entre AZs. Não tem taxa adicional, você paga pelos recursos.
- O **Elastic Load Balancing (ELB)** distribui o tráfego entre destinos íntegros em uma ou mais AZs e verifica a integridade dos destinos. Ele aumenta a disponibilidade e a tolerância a falhas.

| Necessidade | Use | Não use |
|-------------|-----|---------|
| Adicionar e remover instâncias conforme a carga muda, substituir as que falharam | Grupo do EC2 Auto Scaling | ELB (ele não inicia instâncias) |
| Distribuir solicitações e evitar destinos não íntegros | Elastic Load Balancing | Auto Scaling (ele não roteia tráfego) |
| Redimensionar um único servidor de 4 para 16 vCPUs | Escalonamento vertical | Escalonamento horizontal |

```text
 users -> [ ELB, health checks ] -> instance (AZ-a)
                                 -> instance (AZ-b)   <- Auto Scaling group
                                 -> instance (AZ-c)      adds and removes these
```

---

## Acoplamento fraco e nenhum ponto único de falha

Componentes que dependem menos uns dos outros podem falhar e escalar de forma independente. Colocar uma fila entre "checkout" e "faturamento" significa que o faturamento pode atrasar ou falhar sem quebrar o checkout. O **isolamento de falhas** limita até onde uma falha se espalha, e dependências com acoplamento fraco permitem que um workload continue funcionando quando uma dependência está com problemas.

---

## Modelos de serviço e serverless

| Modelo | Definição da AWS | Controle |
|--------|------------------|----------|
| **IaaS** | Blocos de construção básicos: rede, computadores, armazenamento | Mais controle, mais gerenciamento |
| **PaaS** | O provedor elimina a necessidade de gerenciar a infraestrutura subjacente, para que você se concentre na aplicação | Menos a gerenciar |
| **SaaS** | Uma aplicação completa operada e gerenciada pelo fornecedor | Menos controle |

- A AWS publica essas três definições, mas **não classifica seus serviços** nelas. Mapeamentos seguros: o Amazon EC2 é um bloco de construção (estilo IaaS). **AWS Elastic Beanstalk**: você envia o código, e ele provisiona instâncias, configura o balanceamento de carga, configura o monitoramento de integridade e escala o ambiente (semelhante a PaaS).
- **Serverless** é a categoria da própria AWS para executar código sem gerenciar servidores: sem gerenciamento de servidores, pagamento pelo uso, escalabilidade automática de zero ao pico, alta disponibilidade integrada. Exemplos de computação são o **AWS Lambda** e o **AWS Fargate**.
- O Lambda é para tarefas de curta duração. Em 21/11/2026, seu tempo limite máximo é de 30 minutos. Material mais antigo diz 15 minutos. O exame enfatiza o modelo (pagamento por uso, sem servidores para gerenciar), não o limite.
- Não declarado pela AWS: se o Lambda "é FaaS" ou "é PaaS". Alguns livros o rotulam de uma forma, outros de outra. Não confie em nenhum dos rótulos.

---

## Automação e recuperação de desastres (contexto)

- A **infraestrutura como código** provisiona infraestrutura a partir de código em vez de etapas manuais. Benefícios: **repetibilidade** (o mesmo ambiente novamente), **consistência** (menos erros humanos e menos desvio de configuração) e **controle de versão** (acompanhar e reverter mudanças). Serviços da AWS: AWS CloudFormation e o AWS CDK.
- O **RTO** é o atraso máximo aceitável entre a interrupção e a restauração do serviço. O **RPO** é o tempo máximo aceitável desde o último ponto de recuperação, ou seja, a janela máxima de perda de dados.

| Abordagem de DR | O que roda no site de recuperação | Custo e velocidade |
|-----------------|-----------------------------------|--------------------|
| **Backup e restauração** | Somente backups | Mais barata, recuperação mais lenta |
| **Pilot light** | Dados replicados, infraestrutura principal pronta, servidores de aplicação desligados | Baixo custo, não atende tráfego até ser iniciada |
| **Warm standby** | Uma cópia reduzida e totalmente funcional | Atende tráfego com capacidade reduzida |
| **Multi-site ativo/ativo** | Workload completo em cada site | Maior custo, recuperação próxima de zero |

Para a perda de um único data center, um design de alta disponibilidade com várias AZs pode precisar apenas de backup e restauração. Para a perda de uma Região inteira, considere as outras três. O AWS Elastic Disaster Recovery usa a estratégia pilot light. O guia do exame não cita essas estratégias, então dê a elas pouco peso.

---

## Atenção

- **Seis pilares, com a Sustentabilidade.** Uma opção que diz cinco pilares ou lista resiliência como um pilar está errada.
- **Escalabilidade cresce, elasticidade cresce e encolhe automaticamente.** A pista "remove capacidade quando ociosa" significa elasticidade.
- **O Auto Scaling substitui e dimensiona instâncias, o ELB distribui e verifica a integridade.** Nenhum dos dois sozinho faz os dois trabalhos, e o EC2 Auto Scaling trata de instâncias EC2, não é um interruptor genérico de "escalar tudo".
- **Framework vs Tool.** O Framework é a orientação, o Well-Architected Tool é o serviço de revisão.
- **Segurança não é o pilar que se relaxa.** Custo e confiabilidade são equilibrados conforme o contexto, segurança e excelência operacional geralmente não.
- **Não baseie uma resposta em uma frase exata de princípio.** As listas clássicas são históricas desde 16/11/2026.

## Verificação rápida

1. Cite os seis pilares. **Excelência operacional, Segurança, Confiabilidade, Eficiência de performance, Otimização de custos, Sustentabilidade.**
2. Uma loja adiciona servidores no pico e os remove à noite, automaticamente. **Elasticidade.**
3. Qual ferramenta permite que uma equipe responda a perguntas sobre um workload e receba um plano de melhoria? **AWS Well-Architected Tool.**
4. Uma equipe envia o código e quer que a AWS cuide do provisionamento, do balanceamento de carga e do escalonamento. **AWS Elastic Beanstalk.**
5. Qual pilar tolera menor confiabilidade em um protótipo, e qual não tolera segurança mais fraca? **A confiabilidade pode ser relaxada em um protótipo, a segurança geralmente não é sacrificada.**

## Documentação oficial

- [Well-Architected Framework: definitions and terms](https://docs.aws.amazon.com/wellarchitected/latest/framework/definitions.html)
- [Well-Architected Framework: welcome](https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html)
- [Well-Architected Framework: release notes](https://docs.aws.amazon.com/wellarchitected/latest/framework/release-notes.html)
- [AWS Well-Architected Tool](https://docs.aws.amazon.com/wellarchitected/latest/userguide/tool.html)
- [Types of cloud computing](https://aws.amazon.com/types-of-cloud-computing/)
- [What is Amazon EC2 Auto Scaling](https://docs.aws.amazon.com/autoscaling/ec2/userguide/what-is-amazon-ec2-auto-scaling.html)
- [What is Elastic Load Balancing](https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/what-is-load-balancing.html)
- [Disaster recovery options in the cloud](https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-workloads-on-aws/disaster-recovery-options-in-the-cloud.html)
