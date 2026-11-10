---
version: 1.0
updatedAt: 2026-11-04
---
## Learning Objectives

- Describe teach-pendant, walk-through and offline programming, and the trade-offs between them.
- Read a vendor motion instruction (ABB RAPID, Universal Robots URScript) and connect its arguments to the trajectories of `trajectory-planning-in-joint-space`.
- Name the supported ROS 2 distributions with their release and end-of-life dates, as docs.ros.org lists them.
- Explain ROS 2 nodes, topics, services and actions, choose among them, and read the official tutorial code for each.
- Follow a joint trajectory from a ROS 2 action goal to the controller that interpolates it.

## Context & Motivation

`trajectory-planning-in-joint-space` produced trajectories from given configurations and times. Someone still has to say which configurations, in what order, with what speeds, and what the robot does when a gripper closes or a sensor fires. That is robot programming, and it happens in two worlds. Industrial controllers such as ABB's and Universal Robots' come with a pendant and a vendor language, and the program runs on the vendor's controller. ROS 2 is an open framework in which the robot software is a graph of communicating processes.

Practice changes, so where it matters the source and its date are given.

## Core Theory

### Teach-pendant programming

A survey presented by Villani and coauthors at IFAC INCOM 2018 summarizes the traditional method. The operator moves the robot from point to point with the buttons on the pendant and saves each position. The slides go on: "When the whole program has been learned, the robot can play back the points at full speed". The survey lists the costs: the work is tedious, it needs programming expertise, and every new task needs reprogramming, which is hard on small production batches. It also says when the pendant is still necessary: to verify and adjust in place programs generated offline, and for tasks that only an operator near the robot can program.

**Walk-through programming** replaces the buttons: the operator guides the robot by hand, the controller records the significant poses, then interpolates them and plays the trajectory back. The survey notes that safety is critical and that moving to precise coordinates is harder than with the other methods. The URScript manual for PolyScope 5.23 lists `teach_mode()` and `freedrive_mode()` among its motion functions.

### Offline programming

In offline programming the program is written on a computer away from the robot, in simulation software that models the cell in 3D, detects collisions and generates the program, which is then loaded into the controller. In the same survey the gain is downtime: the robot stops only while the new program is downloaded and tested. The costs are the time to build and test the simulation and the gap between model and cell ("Virtual models do not represent the real world with 100% accuracy"), so a calibration step is needed to compensate the mismatch between the real and virtual coordinate systems.

### Vendor languages: what one instruction carries

**ABB RAPID** (Technical reference manual, RAPID overview, RobotWare 6.16.04, revision Y, 2026). Movements are programmed pose to pose; the path in between is computed by the controller. A positioning instruction chooses the interpolation, and its arguments carry the end position, the speed data, the zone data (position accuracy), the tool and the work object. An example from the manual:

```text
MoveL p1,v500,z10,tool1;
MoveC p2,p3,v500,z10,tool1;
MoveL p4,v500,z10,tool1;
```

`MoveJ` is joint interpolation. The manual describes how its speed is set: the controller finds the limiting axis, "the axis that travels fastest relative to its maximum velocity", and computes the velocities of the other axes "so that all axes reach the destination point at the same time". That is the synchronization of Example 3 in `trajectory-planning-in-joint-space`. `MoveL` keeps the tool center point on a straight line; when an axis would need more torque than its motor gives, as near wrist and arm singularities, the manual says the velocity of all axes is reduced automatically. The zone decides whether the point is a stop point or a fly-by point, and "a fly-by point generates a corner path (parabola path) past the programmed position", the blend of Example 4 in the same lesson, which does not reach the point.

**URScript** (script manual for PolyScope 5.23, Universal Robots). `movej(q, a=1.4, v=1.05, t=0, r=0)` moves "linear in joint-space", with `a` and `v` the acceleration and speed of the leading axis in rad/s² and rad/s. The manual states: "The speed and acceleration parameters control the trapezoid speed profile of the move." A time `t` takes priority over `a` and `v`, and a blend radius `r` modifies the trajectory "to avoid the robot stopping at the point". `movel` is linear in tool space. The runtime that executes these programs communicates with the robot at 500 Hz, according to the same manual.

The RAPID manual addresses both modes: it calls itself "particularly useful when programming offline", and it also mentions positions "created on-line by digitizing (teach programming)".

### Book vs today

| Practice | Source, date | Status in the sources read |
|---|---|---|
| Teach points with the pendant, play back | Villani et al., IFAC INCOM 2018 | still documented: RAPID manual 2026 mentions teach programming and the FlexPendant |
| Offline programming in a 3D simulation | Villani et al., 2018 | RAPID manual 2026 is written partly for offline use |
| One language per vendor | RAPID (RobotWare 6.16, 2026), URScript (PolyScope 5.23) | both current |
| Motion planning through ROS | *Modern Robotics* (2017, preprint 2019) cites MoveIt! for ROS | MoveIt 2 for ROS 2, first released in 2019 per its documentation |
| ROS 2 distribution | Ardent Apalone, December 8, 2017, the first after the alphas and betas | Lyrical Luth, May 22, 2026, is the latest |

### ROS 2 distributions

docs.ros.org (Releases page, read in November 2026) lists these as supported:

| Distribution | Release date | End of life |
|---|---|---|
| Lyrical Luth | May 22, 2026 | May 2031 |
| Kilted Kaiju | May 23, 2025 | December 2026 |
| Jazzy Jalisco | May 23, 2024 | May 2029 |
| Humble Hawksbill | May 23, 2022 | May 2027 |

Its release page calls Lyrical "a Long Term Support (LTS) release". Iron Irwini reached end of life on December 4, 2024 and Foxy Fitzroy on June 20, 2023. The page also warns: "Nodes are not guaranteed to be able to communicate across distributions." A system mixing Humble and Lyrical machines is therefore unsupported.

### Nodes, topics, services, actions

From the ROS 2 documentation (Lyrical):

- A **node** is "a participant in the ROS 2 graph, which uses a client library to communicate with other nodes", and "each node should do one logical thing". Nodes find each other through a distributed discovery process.
- A **topic** is a strongly typed, anonymous publish/subscribe channel for continuous data streams such as sensor data or robot state. A topic can have zero or more publishers and zero or more subscribers, and a subscriber does not generally know which publisher sent a message.
- A **service** is a remote procedure call: a request and a response. Services "are expected to return quickly", since the client generally waits. There should be only one server per service name; with several, it is undefined which one answers. `remote-procedure-calls-and-the-illusion-of-a-local-call` separates a lost request, a crashed server and a lost reply, and the same questions apply here.
- An **action** is "a long-running remote procedure call with feedback and the ability to cancel or preempt the goal". Its definition has three parts: goal, result and feedback.

The documentation's guide puts it this way: topics for continuous data, services for quick calls "such as IK", and actions "for any discrete behavior that moves a robot or that runs for a longer time but provides feedback during execution".

## Worked Examples

### Example 1: what a `movej` will take

Turn the base of a UR arm by $90^\circ=1.5708$ rad with the defaults $a=1.4\ \text{rad/s}^2$ and $v=1.05\ \text{rad/s}$, with the base as the leading axis. If the profile is the plain trapezoid of `trajectory-planning-in-joint-space` (an inference from "trapezoid speed profile"; the manual also says the trajectory is influenced by the Motion Version), then $v^2/a=0.7875\le1.5708$, so the axis cruises, with

$$t_b=\frac va=0.75\ \text{s},\qquad T=\frac Dv+\frac va=1.496+0.75=2.246\ \text{s}.$$

For a 0.5 rad move, $v^2/a>D$, the profile is a triangle, $T=2\sqrt{0.5/1.4}=1.195$ s, and the joint never reaches 1.05 rad/s; it peaks at $0.837$ rad/s.

### Example 2: a topic, from the official tutorial

The tutorial "Writing a simple publisher and subscriber (Python)" in the Lyrical documentation builds a talker and a listener. The core of the talker, from the tutorial text:

```python
class MinimalPublisher(Node):

    def __init__(self):
        super().__init__('minimal_publisher')
        self.publisher_ = self.create_publisher(String, 'topic', 10)
        timer_period = 0.5  # seconds
        self.timer = self.create_timer(timer_period, self.timer_callback)
        self.i = 0

    def timer_callback(self):
        msg = String()
        msg.data = 'Hello World: %d' % self.i
        self.publisher_.publish(msg)
        self.get_logger().info('Publishing: "%s"' % msg.data)
        self.i += 1
```

The listener calls `create_subscription(String, 'topic', self.listener_callback, 10)`. The 10 is the queue depth, which the tutorial calls a required Quality of Service setting. The outputs below come from running the two files of the tutorial, unchanged, as plain Python scripts on Lyrical in the official `ros:lyrical` Docker image (Ubuntu 26.04.1, Python 3.14), with the listener started 2.2 s after the talker; timestamps are cut.

```text
[minimal_publisher]: Publishing: "Hello World: 0"
[minimal_publisher]: Publishing: "Hello World: 1"
[minimal_publisher]: Publishing: "Hello World: 2"
[minimal_publisher]: Publishing: "Hello World: 3"
[minimal_subscriber]: I heard: "Hello World: 3"
[minimal_subscriber]: I heard: "Hello World: 4"
```

Messages 0 to 2 were published before the listener's subscription was connected and were never delivered to it, which matches the tutorial's remark that the listener starts "at whatever message count the publisher is on at that time". `ros2 topic info /topic -v` reported reliability `RELIABLE`, history `KEEP_LAST (10)` and durability `VOLATILE` for the talker, and `ros2 topic hz /topic` measured an average rate of 2.003 Hz, the 0.5 s timer.

### Example 3: a service

The service tutorial uses `example_interfaces/srv/AddTwoInts`, whose definition is a request and a response separated by `---`:

```text
int64 a
int64 b
---
int64 sum
```

The server registers `create_service(AddTwoInts, 'add_two_ints', self.add_two_ints_callback)`, and the callback sets `response.sum = request.a + request.b`. The client waits for the service with `wait_for_service`, sends with `call_async` and spins until the future completes. Run the same way:

```text
[minimal_client_async]: Result of add_two_ints: for 41 + 1 = 42
```

and `ros2 service call /add_two_ints example_interfaces/srv/AddTwoInts "{a: 2, b: 3}"` returned `sum=5`.

### Example 4: an action

The action tutorials define `custom_action_interfaces/action/Fibonacci`:

```text
int32 order
---
int32[] sequence
---
int32[] sequence
```

The server's `execute_callback` appends one term per loop, calls `goal_handle.publish_feedback(feedback_msg)`, sleeps 1 s "for dramatic effect", then calls `goal_handle.succeed()` and returns the result. The client sends `order = 10` with a feedback callback. After building the interface package with `colcon`, the run gave:

```text
[fibonacci_action_client]: Goal accepted :)
[fibonacci_action_client]: Received feedback: array('i', [0, 1, 1])
[fibonacci_action_client]: Received feedback: array('i', [0, 1, 1, 2])
...
[fibonacci_action_client]: Result: array('i', [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55])
```

Nine feedback messages arrived about 1 s apart, and the result has 11 numbers: the loop runs for `i` from 1 to 9 on top of the starting `[0, 1]`. The same goal with `order: 5` from `ros2 action send_goal --feedback` produced four feedback messages and a 6-number result. Unlike the service client, it got progress while it waited.

### Example 5: a joint trajectory as an action goal

MoveIt 2's documentation says it typically sends arm motions to a joint trajectory controller, and `ros2_control` provides one, documented for Lyrical, whose documentation names the action server `<controller_name>/follow_joint_trajectory` of type `control_msgs/action/FollowJointTrajectory` and calls it the primary way to send trajectories when execution monitoring is wanted. The goal carries a `trajectory_msgs/JointTrajectory` plus path and goal tolerances; each point has

```text
float64[] positions
float64[] velocities
float64[] accelerations
float64[] effort
builtin_interfaces/Duration time_from_start
```

If tolerances are violated the goal is aborted and the current position is held, per the same documentation.

Take spline B of Example 4 in `trajectory-planning-in-joint-space`, converted to radians: positions $0,\ 0.5236,\ 1.2217,\ 1.0472$ at `time_from_start` 0, 1, 2 and 3 s, velocities $0,\ 0.8727,\ 0.1745,\ 0$ rad/s. With positions and velocities filled, the controller's spline interpolator uses cubic segments, continuous in velocity; adding accelerations switches it to quintic segments, continuous in acceleration; positions alone give linear interpolation, which the documentation discourages. A cubic fixed by the two end positions and velocities of each segment is exactly spline B, so this goal would reproduce it if the controller's cubic is that one. This goal is shown, not run: it illustrates the message structure, not a measured motion.

## Common Misconceptions & Pitfalls

- **"Teach pendants are obsolete."** The 2018 survey lists situations where they remain necessary, and the 2026 RAPID manual still documents teach programming.
- **"Use a service to move the arm."** Services should return quickly; the documentation directs robot motion to actions, which give feedback and can be cancelled.
- **"A subscriber receives everything published on the topic."** A late subscriber with volatile durability gets no earlier messages: the listener of Example 2 missed 0 to 2.

## Summary

Robots are programmed by teaching points on the pendant, by guiding the arm by hand, or offline in a simulation that must then be calibrated to the cell. Vendor instructions carry the trajectory choices of the previous lesson: RAPID's `MoveJ` synchronizes axes on the limiting one and its zones make parabolic fly-by corners, and URScript's `movej` uses a trapezoid set by the leading axis, with a blend radius. In ROS 2, nodes exchange streams on topics, quick calls on services and long, cancellable work with feedback on actions. In November 2026, Lyrical Luth (May 22, 2026, LTS to May 2031) is the latest distribution. A joint trajectory reaches a `ros2_control` controller as a `FollowJointTrajectory` goal, and the fields filled in each point decide whether it is interpolated linearly, by cubics or by quintics.

## Documentation Links

- [ROS 2 Documentation: Distributions](https://docs.ros.org/en/rolling/Releases.html): release and end-of-life dates of every ROS 2 distribution.
- [ROS 2 Documentation: Lyrical Luth](https://docs.ros.org/en/lyrical/Releases/Release-Lyrical-Luth.html): the LTS status and support window of the latest distribution.
- [ROS 2 Documentation: Nodes](https://docs.ros.org/en/lyrical/ROS-Framework/About-Nodes.html): what a node is and how nodes communicate.
- [ROS 2 Documentation: Topics vs Services vs Actions](https://docs.ros.org/en/lyrical/ROS-Framework/interfaces/Topics-Services-Actions.html): when to use each interface type.
- [ROS 2 Documentation: Actions](https://docs.ros.org/en/lyrical/ROS-Framework/interfaces/About-Actions.html): goals, feedback, results and cancellation.
- [ROS 2 tutorial: Writing a simple publisher and subscriber (Python)](https://docs.ros.org/en/lyrical/ROS-Framework/client-libraries/Working-with-Client-Libraries/Writing-A-Simple-Py-Publisher-And-Subscriber.html): the talker and listener of Example 2.
- [ROS 2 tutorial: Writing a simple service and client (Python)](https://docs.ros.org/en/lyrical/ROS-Framework/client-libraries/Working-with-Client-Libraries/Writing-A-Simple-Py-Service-And-Client.html): the AddTwoInts server and client of Example 3.
- [ROS 2 tutorial: Writing an action server and client (Python)](https://docs.ros.org/en/lyrical/ROS-Framework/interfaces/actions/Working-with-actions/Writing-an-Action-Server-Client/Py.html): the Fibonacci action of Example 4.
- [ros2_control: joint trajectory controller](https://control.ros.org/lyrical/doc/ros2_controllers/joint_trajectory_controller/doc/userdoc.html): the FollowJointTrajectory action, tolerances and preemption.
- [MoveIt 2: low-level controllers](https://moveit.picknik.ai/main/doc/examples/controller_configuration/controller_configuration_tutorial.html): how MoveIt sends trajectories to a joint trajectory controller.
- [ABB: Technical reference manual, RAPID overview](https://library.e.abb.com/public/4b22867e301345528bfa6c0b50633795/3HAC050947%20TRM%20RAPID%20Overview%20RW%206-en.pdf): positioning instructions, joint and linear interpolation, and corner paths.
- [Universal Robots: URScript motion module](https://www.universal-robots.com/manuals/EN/HTML/SW5_23/Content/prod-scriptmanual/all_scripts/Module_otion.htm): the move functions and the runtime rate.
- [Universal Robots: movej](https://www.universal-robots.com/manuals/EN/HTML/SW5_23/Content/prod-scriptmanual/all_scripts/movej_qa14v105t0r.htm): the leading-axis trapezoid and the blend radius.
- [Villani et al., Survey on human-robot interaction for robot programming in industrial applications (IFAC INCOM 2018 slides)](https://tc.ifac-control.org/5/3/activities/past/presentations-incom-2018/MoAT2%20-%20INCOM2018_Robot_programming.pdf): teach-pendant, offline and walk-through programming compared.
